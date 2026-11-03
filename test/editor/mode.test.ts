import { describe, expect, it } from 'vitest';
import { currentStaff, modeField, toChanges } from '../../src/editor/mode';
import { click, cursor, digits, DOC, enter, lines, makeState, run, runUndo, STAFF, tabState } from './helpers';

const TWO_STAVES = ['```tab', ...STAFF, '', ...STAFF, '```'];

describe('currentStaff', () => {
	it('is null when off', () => {
		expect(currentStaff(makeState(DOC, 1, 2))).toBeNull();
	});

	it('reports the staff, string row and position', () => {
		const info = currentStaff(tabState(DOC, 2, 12));
		expect(info?.staff.top).toBe(1);
		expect(info?.row).toBe(1);
		expect(info?.pos).toEqual({ measure: 1, beat: 1 });
	});
});

describe('toChanges', () => {
	it('converts rows and columns to document offsets', () => {
		const state = makeState(DOC, 0, 0);
		const from = state.doc.line(2).from;
		expect(toChanges(state, [{ row: 1, from: 2, to: 4, insert: 'ab' }])).toEqual([
			{ from: from + 2, to: from + 4, insert: 'ab' },
		]);
	});
});

describe('document changes in tab mode', () => {
	it('exits with a notice when the staff is deleted', () => {
		let state = tabState(DOC, 1, 2);
		state = state.update({ changes: { from: 0, to: state.doc.length, insert: 'gone' } }).state;
		const mode = state.field(modeField);
		expect(mode.kind).toBe('off');
		expect(mode.kind === 'off' && mode.notice).toMatch(/staff/i);
	});

	it('exits with a notice naming the problem when the staff becomes invalid', () => {
		let state = tabState(DOC, 1, 2);
		const from = state.doc.line(2).from;
		state = state.update({ changes: { from: from + 2, to: from + 3 } }).state;
		const mode = state.field(modeField);
		expect(mode.kind).toBe('off');
		expect(mode.kind === 'off' && mode.notice).toMatch(/line up/);
	});

	it('stays on when an unrelated edit happens', () => {
		let state = tabState(DOC, 1, 2);
		state = state.update({ changes: { from: state.doc.length, insert: '\nmore' } }).state;
		expect(state.field(modeField).kind).toBe('tab');
	});

	// Review Focus 2
	it('writes to the same cell after sync inserts lines above the block', () => {
		let state = tabState(DOC, 2, 5);
		state = state.update({ changes: { from: 0, insert: 'one\ntwo\n' } }).state;
		state = digits(state, '7');
		expect(lines(state)).toEqual(['one', 'two', '```tab', STAFF[0], 'B|---7--|------|', '```']);
	});

	it('undoing the insert that made a new block exits with a notice', () => {
		const state = run(enter(makeState(DOC, 1, 2)), 'exit');
		expect(state.field(modeField).kind).toBe('off');
		const plain = makeState(['text'], 0, 0);
		const inserted = run(plain, 'newStaff');
		expect(inserted.field(modeField).kind).toBe('tab');
		const undone = runUndo(inserted);
		const mode = undone.field(modeField);
		expect(lines(undone)).toEqual(['text']);
		expect(mode.kind).toBe('off');
		expect(mode.kind === 'off' && mode.notice).toMatch(/staff/i);
	});
});

describe('selection changes in tab mode', () => {
	it('snaps a click on a bar to the next measure and clears pending', () => {
		let state = digits(tabState(DOC, 1, 2), '1');
		state = click(state, 1, 8);
		expect(cursor(state)).toEqual({ row: 1, col: 9 });
		state = digits(run(click(state, 1, 2), 'left'), '2');
		expect(lines(state)[1]).toBe('e|2-----|------|');
	});

	it('clears pending when clicking the same cell', () => {
		let state = digits(tabState(DOC, 1, 2), '1');
		state = digits(click(state, 1, 3), '2');
		expect(lines(state)[1]).toBe('e|2-----|------|');
	});

	it('snaps a click on another row of the staff', () => {
		const state = click(tabState(DOC, 1, 2), 2, 6);
		expect(cursor(state)).toEqual({ row: 2, col: 5 });
	});

	it('switches to another valid staff', () => {
		const state = click(tabState(TWO_STAVES, 1, 2), 5, 9);
		const mode = state.field(modeField);
		expect(mode.kind).toBe('tab');
		expect(currentStaff(state)?.staff.top).toBe(4);
		expect(cursor(state)).toEqual({ row: 5, col: 9 });
	});

	it('exits silently on a click on plain text', () => {
		const state = click(tabState(DOC, 1, 2), 0, 0);
		expect(state.field(modeField)).toEqual({ kind: 'off', notice: null });
	});

	it('exits with a notice on a click on an invalid staff', () => {
		const doc = ['```tab', ...STAFF, '', 'e|---|', 'B|----|', '```'];
		const mode = click(tabState(doc, 1, 2), 4, 2).field(modeField);
		expect(mode.kind).toBe('off');
		expect(mode.kind === 'off' && mode.notice).toMatch(/line up/);
	});

	it('leaves selection alone when off', () => {
		const state = click(makeState(DOC, 0, 0), 1, 8);
		expect(cursor(state)).toEqual({ row: 1, col: 8 });
	});

	it('snaps the cursor when undo restores it off a cell', () => {
		let state = tabState(DOC, 1, 5);
		state = digits(state, '4');
		state = runUndo(state);
		expect(lines(state)).toEqual(DOC);
		expect(state.field(modeField).kind).toBe('tab');
		expect((cursor(state).col - 2) % 3).toBe(0);
	});
});
