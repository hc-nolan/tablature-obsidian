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
