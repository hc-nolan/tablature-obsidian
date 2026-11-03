import { describe, expect, it } from 'vitest';
import { clampPos, colToPos, isStaffLine, parseStaff, posToCol, type Staff } from '../../src/core/staff';

function parsed(rows: string[], top = 0): Staff {
	const result = parseStaff(rows, top);
	if (!result.ok) throw new Error(result.problem);
	return result.staff;
}

const BAR = `|${'-'.repeat(12)}`;
const STANDARD = ['e', 'B', 'G', 'D', 'A', 'E'].map((label) => `${label}${BAR}${BAR}${BAR}|`);
const MIXED = ['e|------|---|', 'B|------|---|'];

describe('isStaffLine', () => {
	it.each([
		['e|---|', true],
		['Bb  |---|---|  ', true],
		['F#4|---|', true],
		['| a | b |', false],
		['Label1|---|', false],
		['e|---', false],
		['longer | words |', false],
		['', false],
		['  e|---|', false],
	])('%j → %s', (line, expected) => {
		expect(isStaffLine(line)).toBe(expected);
	});
});

describe('parseStaff', () => {
	it('reads measures with differing beat counts', () => {
		const staff = parsed(MIXED, 10);
		expect(staff.top).toBe(10);
		expect(staff.measures).toEqual([
			{ start: 2, beats: 2 },
			{ start: 9, beats: 1 },
		]);
	});

	it('trims padded labels', () => {
		expect(parsed(['e |---|', 'Eb|---|']).labels).toEqual(['e', 'Eb']);
	});

	it('accepts trailing whitespace on a row', () => {
		expect(parsed(['e|---|  ', 'B|---|']).measures).toHaveLength(1);
	});

	it('reads beats from the text for a wide measure', () => {
		const staff = parsed(STANDARD);
		expect(staff.measures.map((m) => m.beats)).toEqual([4, 4, 4]);
	});

	it('rejects rows whose bars do not line up, naming the row', () => {
		const result = parseStaff(['e|---|', 'B|----|'], 10);
		expect(result).toMatchObject({ ok: false, row: 11 });
		expect(!result.ok && result.problem).toMatch(/line up/);
		expect(!result.ok && result.problem).toMatch(/row 2/);
	});

	it('rejects a measure width that is not a multiple of 3', () => {
		const result = parseStaff(['e|----|', 'B|----|'], 10);
		expect(result).toMatchObject({ ok: false, row: 10 });
		expect(!result.ok && result.problem).toMatch(/multiple of 3/);
	});

	it('rejects an empty measure', () => {
		expect(parseStaff(['e||', 'B||'], 0).ok).toBe(false);
	});
});

describe('colToPos', () => {
	const staff = parsed(MIXED);

	it('snaps the label and first bar to the first beat', () => {
		expect(colToPos(staff, 0)).toEqual({ measure: 0, beat: 0 });
		expect(colToPos(staff, 1)).toEqual({ measure: 0, beat: 0 });
	});

	it('maps every character of a beat to that beat', () => {
		for (const col of [5, 6, 7]) expect(colToPos(staff, col)).toEqual({ measure: 0, beat: 1 });
	});

	it('snaps a bar to the first beat of the following measure', () => {
		expect(colToPos(staff, 8)).toEqual({ measure: 1, beat: 0 });
	});

	it('snaps the final bar and past-the-end to the last beat', () => {
		expect(colToPos(staff, 12)).toEqual({ measure: 1, beat: 0 });
		expect(colToPos(staff, 99)).toEqual({ measure: 1, beat: 0 });
	});
});

describe('posToCol', () => {
	it('matches the Neovim layout for a 4-beat staff', () => {
		const staff = parsed(STANDARD);
		expect(posToCol(staff, { measure: 0, beat: 0 })).toBe(2);
		expect(posToCol(staff, { measure: 0, beat: 2 })).toBe(8);
		expect(posToCol(staff, { measure: 1, beat: 0 })).toBe(15);
		expect(posToCol(staff, { measure: 2, beat: 0 })).toBe(28);
	});

	it('accounts for a wider earlier measure', () => {
		expect(posToCol(parsed(MIXED), { measure: 1, beat: 0 })).toBe(9);
	});

	it('round-trips with colToPos', () => {
		const staff = parsed(STANDARD);
		for (const pos of [{ measure: 0, beat: 0 }, { measure: 0, beat: 3 }, { measure: 1, beat: 3 }]) {
			expect(colToPos(staff, posToCol(staff, pos))).toEqual(pos);
		}
	});
});

describe('clampPos', () => {
	const staff = parsed(MIXED);

	it('clamps measure and beat to the staff', () => {
		expect(clampPos(staff, { measure: 5, beat: 3 })).toEqual({ measure: 1, beat: 0 });
		expect(clampPos(staff, { measure: 0, beat: 9 })).toEqual({ measure: 0, beat: 1 });
		expect(clampPos(staff, { measure: -1, beat: -1 })).toEqual({ measure: 0, beat: 0 });
	});
});
