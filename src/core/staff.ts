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
}

export interface Staff {
	/** Document row of the top line. */
	top: number;
	rows: string[];
	/** Trimmed labels, top to bottom. */
	labels: string[];
	measures: Measure[];
}

export type ParseResult = { ok: true; staff: Staff } | { ok: false; row: number; problem: string };

export const BEAT_WIDTH = 3;

const STAFF_LINE = /^[^\s|]{1,4} *\|.*\|\s*$/;

export function isStaffLine(line: string): boolean {
	return STAFF_LINE.test(line);
}

function barColumns(row: string): number[] {
	const columns: number[] = [];
	for (let col = 0; col < row.length; col++) {
		if (row[col] === '|') columns.push(col);
	}
	return columns;
}

export function parseStaff(rows: string[], top: number): ParseResult {
	const bars = barColumns(rows[0] ?? '');
	for (let i = 1; i < rows.length; i++) {
		const other = barColumns(rows[i] ?? '');
		if (other.length !== bars.length || other.some((col, j) => col !== bars[j])) {
			return { ok: false, row: top + i, problem: `The bars on row ${i + 1} of this staff don't line up with row 1.` };
		}
	}

	const measures: Measure[] = [];
	for (let i = 0; i + 1 < bars.length; i++) {
		const start = (bars[i] as number) + 1;
		const width = (bars[i + 1] as number) - start;
		if (width === 0 || width % BEAT_WIDTH !== 0) {
			return {
				ok: false,
				row: top,
				problem: `Measure ${i + 1} of this staff is ${width} characters wide, which isn't a positive multiple of 3.`,
			};
		}
		measures.push({ start, beats: width / BEAT_WIDTH });
	}

	const labelEnd = bars[0] ?? 0;
	return {
		ok: true,
		staff: { top, rows, labels: rows.map((row) => row.slice(0, labelEnd).trim()), measures },
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

/** A replacement within one document row. `insert` may contain newlines. */
export interface LineEdit {
	row: number;
	from: number;
	to: number;
	insert: string;
}

const MAX_BEATS = 128;
const FILLER = '-';
const CONTENT_WIDTH = 2;

export function cellEdit(staff: Staff, stringRow: number, pos: Pos, content: string): LineEdit {
	const from = posToCol(staff, pos);
	return { row: staff.top + stringRow, from, to: from + CONTENT_WIDTH, insert: content.padEnd(CONTENT_WIDTH, FILLER) };
}

export function writeFret(
	staff: Staff,
	stringRow: number,
	pos: Pos,
	digit: string,
	pending: boolean,
): { edit: LineEdit; pending: boolean } {
	const existing = (staff.rows[stringRow] as string)[posToCol(staff, pos)] ?? '';
	if (pending && /\d/.test(existing)) {
		return { edit: cellEdit(staff, stringRow, pos, existing + digit), pending: false };
	}
	return { edit: cellEdit(staff, stringRow, pos, digit), pending: true };
}

export function clearCell(staff: Staff, stringRow: number, pos: Pos): LineEdit {
	return cellEdit(staff, stringRow, pos, '');
}

export function setMeasureBeats(staff: Staff, measure: number, beats: number): LineEdit[] {
	const target = staff.measures[measure] as Measure;
	if (beats === target.beats) return [];
	const oldEnd = target.start + target.beats * BEAT_WIDTH;
	return staff.rows.map((_, i) =>
		beats > target.beats
			? { row: staff.top + i, from: oldEnd, to: oldEnd, insert: FILLER.repeat((beats - target.beats) * BEAT_WIDTH) }
			: { row: staff.top + i, from: target.start + beats * BEAT_WIDTH, to: oldEnd, insert: '' },
	);
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
