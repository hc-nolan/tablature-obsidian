// Parsing and text edits for a single staff. Pure: no editor or Obsidian dependencies.

/** Measure and beat, both 0-indexed. */
export interface Pos {
	measure: number;
	beat: number;
}

export interface Measure {
	/** Column of the measure's first cell. */
	start: number;
	beats: number;
	/** Opened by `|:`. */
	repeatStart: boolean;
	/** Closed by `:|`. */
	repeatEnd: boolean;
}

/** A bar line, with the repeat colons either side of its `|`. Columns are the same on every row. */
export interface Bar {
	from: number;
	pipe: number;
	/** Exclusive. */
	to: number;
}

export interface Staff {
	/** Document row of the top line. */
	top: number;
	rows: string[];
	/** Trimmed labels, top to bottom. */
	labels: string[];
	measures: Measure[];
	/** One more than `measures`: bar `i` opens measure `i`. */
	bars: Bar[];
}

export type ParseResult = { ok: true; staff: Staff } | { ok: false; row: number; problem: string };

export const BEAT_WIDTH = 3;

const STAFF_LINE = /^[^\s|]{1,4} *\|.*\|\s*$/;

export function isStaffLine(line: string): boolean {
	return STAFF_LINE.test(line);
}

const REPEAT = ':';

/** Finds each `|` with its repeat colons. Only a bar with a measure before it can close a repeat, and after it open one. */
function findBars(row: string): Bar[] {
	const pipes: number[] = [];
	for (let col = 0; col < row.length; col++) {
		if (row[col] === '|') pipes.push(col);
	}
	return pipes.map((pipe, i) => ({
		from: i > 0 && row[pipe - 1] === REPEAT ? pipe - 1 : pipe,
		pipe,
		to: i + 1 < pipes.length && row[pipe + 1] === REPEAT ? pipe + 2 : pipe + 1,
	}));
}

const sameBar = (a: Bar, b: Bar | undefined): boolean => a.from === b?.from && a.pipe === b.pipe && a.to === b.to;

export function parseStaff(rows: string[], top: number): ParseResult {
	const bars = findBars(rows[0] ?? '');
	for (let i = 1; i < rows.length; i++) {
		const other = findBars(rows[i] ?? '');
		if (other.length !== bars.length || bars.some((bar, j) => !sameBar(bar, other[j]))) {
			return { ok: false, row: top + i, problem: `The bars on row ${i + 1} of this staff don't line up with row 1.` };
		}
	}

	const measures: Measure[] = [];
	for (let i = 0; i + 1 < bars.length; i++) {
		const open = bars[i] as Bar;
		const close = bars[i + 1] as Bar;
		const width = close.from - open.to;
		if (width <= 0 || width % BEAT_WIDTH !== 0) {
			return {
				ok: false,
				row: top,
				problem: `Measure ${i + 1} of this staff is ${width} characters wide, which isn't a positive multiple of 3.`,
			};
		}
		measures.push({
			start: open.to,
			beats: width / BEAT_WIDTH,
			repeatStart: open.to > open.pipe + 1,
			repeatEnd: close.from < close.pipe,
		});
	}

	const labelEnd = bars[0]?.pipe ?? 0;
	return {
		ok: true,
		staff: { top, rows, labels: rows.map((row) => row.slice(0, labelEnd).trim()), measures, bars },
	};
}

export function colToPos(staff: Staff, col: number): Pos {
	for (const [measure, { start, beats }] of staff.measures.entries()) {
		if (col < start) return { measure, beat: 0 };
		if (col < start + beats * BEAT_WIDTH) return { measure, beat: Math.floor((col - start) / BEAT_WIDTH) };
	}
	const measure = staff.measures.length - 1;
	return { measure, beat: (staff.measures[measure] as Measure).beats - 1 };
}

export function posToCol(staff: Staff, pos: Pos): number {
	return (staff.measures[pos.measure] as Measure).start + pos.beat * BEAT_WIDTH;
}

export function clampPos(staff: Staff, pos: Pos): Pos {
	const measure = Math.max(0, Math.min(staff.measures.length - 1, pos.measure));
	const beats = (staff.measures[measure] as Measure).beats;
	return { measure, beat: Math.max(0, Math.min(beats - 1, pos.beat)) };
}

/** A replacement starting in one document row. `insert` may contain newlines, and `to` may run past the row's end. */
export interface LineEdit {
	row: number;
	from: number;
	to: number;
	insert: string;
}

const MAX_BEATS = 128;
const FILLER = '-';
const TENS_DIGIT = /^[12]$/;

/** Writes `content` over the whole cell, clearing any slide or bend left from the fret it replaces. */
export function cellEdit(staff: Staff, stringRow: number, pos: Pos, content: string): LineEdit {
	const from = posToCol(staff, pos);
	return { row: staff.top + stringRow, from, to: from + BEAT_WIDTH, insert: content.padEnd(BEAT_WIDTH, FILLER) };
}

const TECHNIQUE = /^[/\\b]$/;

export function writeFret(
	staff: Staff,
	stringRow: number,
	pos: Pos,
	digit: string,
	pending: boolean,
): { edit: LineEdit; pending: boolean } {
	const from = posToCol(staff, pos);
	const cell = (staff.rows[stringRow] as string).slice(from, from + BEAT_WIDTH);
	// A single-digit fret leaves room for its slide or bend target: 7b9.
	if (/^\d$/.test(cell[0] ?? '') && TECHNIQUE.test(cell[1] ?? '') && cell[2] === FILLER) {
		return { edit: { row: staff.top + stringRow, from: from + 2, to: from + 3, insert: digit }, pending: false };
	}
	const existing = cell[0] ?? '';
	if (pending && TENS_DIGIT.test(existing) && cell[1] === FILLER) {
		return { edit: cellEdit(staff, stringRow, pos, existing + digit), pending: false };
	}
	// Frets run into the 10s and 20s, so only a 1 or 2 can start a double-digit fret.
	return { edit: cellEdit(staff, stringRow, pos, digit), pending: TENS_DIGIT.test(digit) };
}

/** Clears the fret and its technique, which means nothing without a note. */
export function clearCell(staff: Staff, stringRow: number, pos: Pos): LineEdit {
	const from = posToCol(staff, pos);
	return { row: staff.top + stringRow, from, to: from + BEAT_WIDTH, insert: FILLER.repeat(BEAT_WIDTH) };
}

/**
 * Slide up, slide down, or bend. It follows the fret in the same cell, so it takes no extra beat. A single-digit fret
 * has room for the target (7b9); a double-digit one doesn't (13b).
 */
export type Technique = '/' | '\\' | 'b';

export type TechniqueResult = { ok: true; edit: LineEdit } | { ok: false; problem: string };

/** Marks the cell's fret with `technique`, or removes it (and its target) if it's already marked. */
export function toggleTechnique(staff: Staff, stringRow: number, pos: Pos, technique: Technique): TechniqueResult {
	const from = posToCol(staff, pos);
	const cell = (staff.rows[stringRow] as string).slice(from, from + BEAT_WIDTH);
	const fret = /^\d{1,2}/.exec(cell)?.[0];
	if (!fret) return { ok: false, problem: 'Write a fret first, then add a slide or bend to it.' };
	const at = from + fret.length;
	const edit = (insert: string): TechniqueResult => ({
		ok: true,
		edit: { row: staff.top + stringRow, from: at, to: from + BEAT_WIDTH, insert },
	});
	const mark = cell[fret.length];
	if (mark === technique) return edit(FILLER.repeat(BEAT_WIDTH - fret.length));
	// Switching between slide and bend keeps the target.
	return edit(technique + cell.slice(fret.length + 1).replace(/\D/g, FILLER));
}

/** Resizes every measure of the staff to `beats`, padding with filler or dropping trailing beats. */
export function setStaffBeats(staff: Staff, beats: number): LineEdit[] {
	if (staff.measures.every((measure) => measure.beats === beats)) return [];
	const first = staff.measures[0] as Measure;
	const last = staff.measures[staff.measures.length - 1] as Measure;
	const width = beats * BEAT_WIDTH;
	return staff.rows.map((row, i) => ({
		row: staff.top + i,
		from: first.start,
		to: last.start + last.beats * BEAT_WIDTH,
		insert: staff.measures
			.map(({ start, beats: old }, m) => {
				const body = row.slice(start, start + Math.min(old * BEAT_WIDTH, width)).padEnd(width, FILLER);
				// Keep each inner bar as written, repeat colons included.
				const bar = m + 1 < staff.measures.length ? barText(staff, m + 1) : '';
				return body + bar;
			})
			.join(''),
	}));
}

function barText(staff: Staff, index: number): string {
	const { from, to } = staff.bars[index] as Bar;
	return (staff.rows[0] as string).slice(from, to);
}

/** Measures `from` to `to` inclusive. */
export interface Span {
	from: number;
	to: number;
}

/**
 * Pairs each `|:` with the next `:|`. As in sheet music, a `:|` with no `|:` repeats from the last repeat's end,
 * or the start of the staff. An unclosed `|:` runs until the next `|:`, or the end of the staff.
 */
export function repeatSpans(staff: Staff): Span[] {
	const spans: Span[] = [];
	let open: number | null = null;
	let after = 0;
	staff.measures.forEach(({ repeatStart, repeatEnd }, i) => {
		if (repeatStart) {
			if (open !== null) spans.push({ from: open, to: i - 1 });
			open = i;
		}
		if (repeatEnd) {
			spans.push({ from: open ?? after, to: i });
			open = null;
			after = i + 1;
		}
	});
	if (open !== null) spans.push({ from: open, to: staff.measures.length - 1 });
	return spans;
}

/**
 * Removes the repeat on measures `from` to `to` if there's one on exactly those measures. Otherwise repeats them,
 * replacing any repeats they overlap, since repeats don't nest.
 */
export function toggleRepeat(staff: Staff, from: number, to: number): LineEdit[] {
	const starts = staff.measures.map((measure) => measure.repeatStart);
	const ends = staff.measures.map((measure) => measure.repeatEnd);
	const spans = repeatSpans(staff);
	const exact = spans.some((span) => span.from === from && span.to === to);
	for (const span of spans) {
		if (span.from <= to && span.to >= from) {
			starts[span.from] = false;
			ends[span.to] = false;
		}
	}
	if (!exact) {
		starts[from] = true;
		ends[to] = true;
	}

	// The opening colon sits just after its bar's pipe, the closing one just before.
	const marks: LineEdit[] = [];
	const mark = (col: number, present: boolean, wanted: boolean, insertAt: number): void => {
		if (present === wanted) return;
		marks.push(wanted ? { row: 0, from: insertAt, to: insertAt, insert: REPEAT } : { row: 0, from: col, to: col + 1, insert: '' });
	};
	staff.measures.forEach((measure, i) => {
		const open = (staff.bars[i] as Bar).pipe + 1;
		const close = (staff.bars[i + 1] as Bar).pipe;
		mark(open, measure.repeatStart, starts[i] as boolean, open);
		mark(close - 1, measure.repeatEnd, ends[i] as boolean, close);
	});
	return staff.rows.flatMap((_, i) => marks.map((edit) => ({ ...edit, row: staff.top + i })));
}

/** Copies measures `from` to `to` inclusive, one string per row, keeping the bars between them. */
export function copyMeasures(staff: Staff, from: number, to: number): string[] {
	const first = staff.measures[from] as Measure;
	const last = staff.measures[to] as Measure;
	return staff.rows.map((row) => row.slice(first.start, last.start + last.beats * BEAT_WIDTH));
}

export type PasteResult = { ok: true; edits: LineEdit[] } | { ok: false; problem: string };

/** Inserts copied measures after measure `after`. */
export function pasteMeasures(staff: Staff, after: number, copied: string[]): PasteResult {
	if (copied.length !== staff.rows.length) {
		return {
			ok: false,
			problem: `The copied measures have ${copied.length} strings, but this staff has ${staff.rows.length}.`,
		};
	}
	// Insert just after the closing pipe, so this measure keeps its `:|` and the next keeps its `|:`.
	const at = (staff.bars[after + 1] as Bar).pipe + 1;
	return {
		ok: true,
		edits: staff.rows.map((_, i) => ({ row: staff.top + i, from: at, to: at, insert: `${copied[i] as string}|` })),
	};
}

/** Removes measures `from` to `to` inclusive with one of their bars. A staff keeps at least one measure. */
export function deleteMeasures(staff: Staff, from: number, to: number): PasteResult {
	if (from === 0 && to === staff.measures.length - 1) {
		return { ok: false, problem: "A staff needs at least one measure, so this can't delete them all." };
	}
	// Merge the bars either side of the range, keeping the repeat marks of the measures that remain.
	const before = staff.measures[from - 1];
	const after = staff.measures[to + 1];
	const bar = `${before?.repeatEnd ? REPEAT : ''}|${after?.repeatStart ? REPEAT : ''}`;
	const cut = (staff.bars[from] as Bar).from;
	const until = (staff.bars[to + 1] as Bar).to;
	return { ok: true, edits: staff.rows.map((_, i) => ({ row: staff.top + i, from: cut, to: until, insert: bar })) };
}

export function relabel(staff: Staff, labelsLowToHigh: string[]): LineEdit[] {
	const width = Math.max(...labelsLowToHigh.map((label) => label.length));
	const labelEnd = (staff.rows[0] as string).indexOf('|');
	return staff.rows.map((_, i) => ({
		row: staff.top + i,
		from: 0,
		to: labelEnd,
		insert: (labelsLowToHigh[staff.rows.length - 1 - i] as string).padEnd(width, ' '),
	}));
}

export type RestringResult = { ok: true; edit: LineEdit } | { ok: false; problem: string };

/**
 * Relabels a staff with a tuning that may have a different string count. The low strings are kept in place:
 * extra high strings are added as blank rows at the top, and surplus high strings are removed from the top,
 * which is refused if any of them has notes.
 */
export function restring(staff: Staff, labelsLowToHigh: string[]): RestringResult {
	const labelEnd = (staff.rows[0] as string).indexOf('|');
	const surplus = staff.rows.length - labelsLowToHigh.length;
	const removed = staff.rows.slice(0, Math.max(0, surplus));
	// Repeat colons are part of the bars, not notes.
	const noted = removed.findIndex((row) => /[^|:\s-]/.test(row.slice(labelEnd)));
	if (noted >= 0) {
		const label = staff.labels[noted] as string;
		return { ok: false, problem: `The ${label} string has notes on it. Clear them first, then switch instruments.` };
	}

	const blank = (staff.rows[0] as string).slice(labelEnd).replace(/[^|:\s]/g, FILLER);
	const bodies = [
		...Array.from({ length: Math.max(0, -surplus) }, () => blank),
		...staff.rows.slice(Math.max(0, surplus)).map((row) => row.slice(labelEnd)),
	];
	const width = Math.max(...labelsLowToHigh.map((label) => label.length));
	const highToLow = [...labelsLowToHigh].reverse();
	const insert = bodies.map((body, i) => (highToLow[i] as string).padEnd(width, ' ') + body).join('\n');
	return { ok: true, edit: { row: staff.top, from: 0, to: staff.rows.join('\n').length, insert } };
}

export function generateStaff(labelsLowToHigh: string[], measures: number, beats: number): string[] {
	const width = Math.max(...labelsLowToHigh.map((label) => label.length));
	const body = `|${`${FILLER.repeat(beats * BEAT_WIDTH)}|`.repeat(measures)}`;
	return [...labelsLowToHigh].reverse().map((label) => label.padEnd(width, ' ') + body);
}

export function staffLabelsLowToHigh(staff: Staff): string[] {
	return [...staff.labels].reverse();
}

export function parseBeatCount(text: string): number | null {
	const trimmed = text.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const beats = Number(trimmed);
	return beats >= 1 && beats <= MAX_BEATS ? beats : null;
}
