import { describe, expect, it } from 'vitest';
import {
	clampPos,
	clearCell,
	colToPos,
	generateStaff,
	isStaffLine,
	type LineEdit,
	parseBeatCount,
	parseStaff,
	posToCol,
	relabel,
	setMeasureBeats,
	type Staff,
	staffLabelsLowToHigh,
	writeFret,
} from '../../src/core/staff';

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

function apply(rows: string[], edits: LineEdit[], top = 0): string[] {
	const out = [...rows];
	for (const edit of edits) {
		const i = edit.row - top;
		const row = out[i] as string;
		out[i] = row.slice(0, edit.from) + edit.insert + row.slice(edit.to);
	}
	return out;
}

describe('writeFret', () => {
	const pos = { measure: 0, beat: 0 };
	const on = (row: string) => parsed([row, 'B|---------|']);

	it('writes a single digit and sets pending', () => {
		const { edit, pending } = writeFret(on('e|---------|'), 0, pos, '5', false);
		expect(apply(['e|---------|'], [edit])[0]).toBe('e|5--------|');
		expect(pending).toBe(true);
	});

	it('makes a double-digit fret when pending and clears pending', () => {
		const { edit, pending } = writeFret(on('e|5--------|'), 0, pos, '2', true);
		expect(apply(['e|5--------|'], [edit])[0]).toBe('e|52-------|');
		expect(pending).toBe(false);
	});

	it('overwrites a double-digit fret when not pending', () => {
		const { edit, pending } = writeFret(on('e|52-------|'), 0, pos, '3', false);
		expect(apply(['e|52-------|'], [edit])[0]).toBe('e|3--------|');
		expect(pending).toBe(true);
	});

	it('treats pending on a non-digit cell as a fresh write', () => {
		const { edit, pending } = writeFret(on('e|-x-------|'), 0, pos, '7', true);
		expect(apply(['e|-x-------|'], [edit])[0]).toBe('e|7--------|');
		expect(pending).toBe(true);
	});

	it('targets the given string and beat, offset by the staff top', () => {
		const staff = parsed(['e|---------|', 'B|---------|'], 20);
		const { edit } = writeFret(staff, 1, { measure: 0, beat: 1 }, '9', false);
		expect(edit.row).toBe(21);
		expect(apply(staff.rows, [edit], 20)).toEqual(['e|---------|', 'B|---9-----|']);
	});
});

describe('clearCell', () => {
	const pos = { measure: 0, beat: 0 };

	it('clears both digits of a double-digit fret', () => {
		const rows = ['e|12-------|', 'B|---------|'];
		expect(apply(rows, [clearCell(parsed(rows), 0, pos)])[0]).toBe('e|---------|');
	});

	it('keeps the third character of the cell', () => {
		const rows = ['e|12h------|', 'B|---------|'];
		expect(apply(rows, [clearCell(parsed(rows), 0, pos)])[0]).toBe('e|--h------|');
	});
});

describe('setMeasureBeats', () => {
	it('grows a measure on every row, preserving notes', () => {
		const rows = ['e|5--|2--|', 'B|---|---|'];
		expect(apply(rows, setMeasureBeats(parsed(rows), 0, 2))).toEqual(['e|5-----|2--|', 'B|------|---|']);
	});

	it('shrinks a measure by dropping trailing beats, even with content', () => {
		const rows = ['e|5--2--|', 'B|------|'];
		expect(apply(rows, setMeasureBeats(parsed(rows), 0, 1))).toEqual(['e|5--|', 'B|---|']);
	});

	it('changes only the target measure', () => {
		const rows = ['e|---|5--|', 'B|---|---|'];
		const result = parseStaff(apply(rows, setMeasureBeats(parsed(rows), 1, 3)), 0);
		expect(result.ok && result.staff.measures.map((m) => m.beats)).toEqual([1, 3]);
	});

	it('produces no edits when the count is unchanged', () => {
		const rows = ['e|---|', 'B|---|'];
		expect(setMeasureBeats(parsed(rows), 0, 1)).toEqual([]);
	});
});

describe('relabel', () => {
	const BLANK = '|---------------|';
	const standard = ['e', 'B', 'G', 'D', 'A', 'E'].map((l) => l + BLANK);

	it('changes only the labels that differ', () => {
		const out = apply(standard, relabel(parsed(standard), ['D', 'A', 'D', 'G', 'B', 'e']));
		expect(out[0]).toBe(`e${BLANK}`);
		expect(out[5]).toBe(`D${BLANK}`);
	});

	it('preserves cell content', () => {
		const rows = ['e|5--------------|', ...standard.slice(1)];
		const out = apply(rows, relabel(parsed(rows), ['D', 'A', 'D', 'G', 'B', 'e']));
		expect(out[0]).toBe('e|5--------------|');
	});

	it('pads all labels to the new maximum width', () => {
		const rows = ['e|---|', 'E|---|'];
		expect(apply(rows, relabel(parsed(rows), ['C#', 'e']))).toEqual(['e |---|', 'C#|---|']);
	});

	it('narrows padding when the new labels are shorter', () => {
		const rows = ['e |---|', 'C#|---|'];
		expect(apply(rows, relabel(parsed(rows), ['E', 'e']))).toEqual(['e|---|', 'E|---|']);
	});
});

describe('generateStaff', () => {
	it('lists rows high to low', () => {
		expect(generateStaff(['E', 'e'], 2, 1)).toEqual(['e|---|---|', 'E|---|---|']);
	});

	it('pads labels so bars line up', () => {
		expect(generateStaff(['Eb', 'e'], 1, 1)).toEqual(['e |---|', 'Eb|---|']);
	});

	it('matches the Neovim default length of 106 characters', () => {
		const lines = generateStaff(['E', 'A', 'D', 'G', 'B', 'e'], 8, 4);
		expect(lines).toHaveLength(6);
		for (const line of lines) expect(line).toHaveLength(106);
	});

	it('produces a staff that parses', () => {
		expect(parseStaff(generateStaff(['E', 'A'], 3, 2), 0).ok).toBe(true);
	});
});

describe('staffLabelsLowToHigh', () => {
	it('reverses the top-to-bottom labels', () => {
		expect(staffLabelsLowToHigh(parsed(['e |---|', 'Eb|---|']))).toEqual(['Eb', 'e']);
	});
});

describe('parseBeatCount', () => {
	it.each([
		['4', 4],
		[' 16 ', 16],
		['128', 128],
		['0', null],
		['2.5', null],
		['abc', null],
		['', null],
		['-3', null],
		['129', null],
	])('%j → %s', (text, expected) => {
		expect(parseBeatCount(text)).toBe(expected);
	});
});
