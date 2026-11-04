import { EditorSelection } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { type Action, applyAction, applyBeats, applyTuning, enterAt, enterChord, insertStaff } from '../../src/editor/actions';
import { buildDecorations } from '../../src/editor/decorations';
import { currentStaff, modeField } from '../../src/editor/mode';
import { applyResult, cursor, digits, DOC, lines, makeState, run, runUndo, STAFF, tabState } from './helpers';

const STD_ROWS = ['e', 'B', 'G', 'D', 'A', 'E'].map((label) => `${label}|---|`);

describe('enterAt', () => {
	it('gives a notice off a staff and stays off', () => {
		const state = makeState(DOC, 0, 0);
		const result = enterAt(state, DEFAULT_CONFIG);
		expect(result.notice).toMatch(/staff/i);
		expect(result.spec).toBeUndefined();
	});

	it('names the problem on an invalid staff', () => {
		const result = enterAt(makeState(['```', 'e|---|', 'B|----|', '```'], 1, 0), DEFAULT_CONFIG);
		expect(result.notice).toMatch(/line up/);
		expect(result.spec).toBeUndefined();
	});

	it('snaps from a label to the first beat', () => {
		const state = tabState(DOC, 1, 0);
		expect(state.field(modeField).kind).toBe('tab');
		expect(cursor(state)).toEqual({ row: 1, col: 2 });
	});

	it('collapses extra cursors', () => {
		const base = makeState(DOC, 1, 2);
		const from = base.doc.line(3).from;
		const multi = base.update({
			selection: EditorSelection.create([EditorSelection.cursor(base.selection.main.head), EditorSelection.cursor(from)]),
		}).state;
		const entered = applyResult(multi, enterAt(multi, DEFAULT_CONFIG));
		expect(entered.selection.ranges).toHaveLength(1);
	});
});

describe('movement', () => {
	it('stays at the first beat on left', () => {
		expect(cursor(run(tabState(DOC, 1, 2), 'left'))).toEqual({ row: 1, col: 2 });
	});

	it('crosses a bar going right and left', () => {
		const right = run(tabState(DOC, 1, 5), 'right');
		expect(cursor(right)).toEqual({ row: 1, col: 9 });
		expect(cursor(run(right, 'left'))).toEqual({ row: 1, col: 5 });
	});

	it('stops at the staff end, regardless of default measures', () => {
		const config = { ...DEFAULT_CONFIG, measures: 1 };
		const moved = run(tabState(DOC, 1, 5), 'right', config);
		expect(cursor(moved)).toEqual({ row: 1, col: 9 });
		expect(cursor(run(tabState(DOC, 1, 12), 'right'))).toEqual({ row: 1, col: 12 });
	});

	it('moves to the first beat of adjacent measures', () => {
		expect(cursor(run(tabState(DOC, 1, 12), 'prevMeasure'))).toEqual({ row: 1, col: 2 });
		expect(cursor(run(tabState(DOC, 1, 5), 'nextMeasure'))).toEqual({ row: 1, col: 9 });
	});

	it('does not move past the first or last measure', () => {
		expect(cursor(run(tabState(DOC, 1, 5), 'prevMeasure'))).toEqual({ row: 1, col: 5 });
		expect(cursor(run(tabState(DOC, 1, 12), 'nextMeasure'))).toEqual({ row: 1, col: 12 });
	});

	it('moves between strings keeping the position', () => {
		const down = run(tabState(DOC, 1, 5), 'nextString');
		expect(cursor(down)).toEqual({ row: 2, col: 5 });
		expect(cursor(run(down, 'prevString'))).toEqual({ row: 1, col: 5 });
	});

	it('stays put at the document edges', () => {
		expect(cursor(run(tabState(DOC, 2, 2), 'nextString'))).toEqual({ row: 2, col: 2 });
		expect(cursor(run(tabState(DOC, 1, 2), 'prevString'))).toEqual({ row: 1, col: 2 });
	});

	// Review Focus 3
	describe('between staves', () => {
		const small = ['e|---|', 'B|---|'];
		const large = ['e|------|---|', 'B|------|---|', 'G|------|---|'];

		it('lands on the top row of the next staff, clamped to its layout', () => {
			const doc = ['```tab', ...large, '', ...small, '```'];
			const state = run(tabState(doc, 3, 9), 'nextString');
			expect(cursor(state)).toEqual({ row: 5, col: 2 });
			expect(currentStaff(state)?.staff.top).toBe(5);
		});

		it('lands on the bottom row of the previous staff, using its own height', () => {
			const threeAboveTwo = ['```tab', ...large, '', ...small, '```'];
			expect(cursor(run(tabState(threeAboveTwo, 5, 2), 'prevString')).row).toBe(3);
			const twoAboveThree = ['```tab', ...small, '', ...large, '```'];
			expect(cursor(run(tabState(twoAboveThree, 4, 2), 'prevString')).row).toBe(2);
		});

		it('crosses into another block', () => {
			const doc = ['```tab', ...small, '```', 'text', '```', ...small, '```'];
			expect(cursor(run(tabState(doc, 2, 2), 'nextString')).row).toBe(6);
		});

		it('stays with a notice when the next staff is invalid', () => {
			const doc = ['```tab', ...small, '', 'e|---|', 'B|----|', '```'];
			const state = tabState(doc, 2, 2);
			const result = applyAction(state, { type: 'nextString' }, DEFAULT_CONFIG);
			expect(result.notice).toMatch(/line up/);
			expect(cursor(applyResult(state, result))).toEqual({ row: 2, col: 2 });
		});

		it('clears pending when switching staves', () => {
			const doc = ['```tab', ...small, '', ...small, '```'];
			let state = digits(tabState(doc, 2, 2), '1');
			state = run(run(state, 'nextString'), 'prevString');
			expect(lines(digits(state, '2'))[2]).toBe('B|2--|');
		});
	});
});

describe('writing', () => {
	it('builds a double-digit fret from two digits', () => {
		expect(lines(digits(tabState(DOC, 1, 2), '12'))[1]).toBe('e|12----|------|');
	});

	it('keeps the cursor on the cell after writing', () => {
		expect(cursor(digits(tabState(DOC, 1, 5), '12'))).toEqual({ row: 1, col: 5 });
	});

	it('undoes one digit at a time', () => {
		const state = runUndo(digits(tabState(DOC, 1, 2), '12'));
		expect(lines(state)[1]).toBe('e|1-----|------|');
	});

	it('restarts after movement', () => {
		const moved = run(run(digits(tabState(DOC, 1, 2), '1'), 'right'), 'left');
		expect(lines(digits(moved, '2'))[1]).toBe('e|2-----|------|');
	});

	it('restarts on a third digit', () => {
		expect(lines(digits(tabState(DOC, 1, 2), '123'))[1]).toBe('e|3-----|------|');
	});

	it('clears and clears-then-moves-left', () => {
		const written = digits(tabState(DOC, 1, 5), '12');
		expect(lines(run(written, 'clear'))[1]).toBe('e|------|------|');
		const left = run(written, 'clearLeft');
		expect(lines(left)[1]).toBe('e|------|------|');
		expect(cursor(left)).toEqual({ row: 1, col: 2 });
	});

	it('clears pending on clear', () => {
		const state = digits(run(digits(tabState(DOC, 1, 2), '1'), 'clear'), '2');
		expect(lines(state)[1]).toBe('e|2-----|------|');
	});
});

describe('exit', () => {
	it('turns tab mode off silently', () => {
		expect(run(tabState(DOC, 1, 2), 'exit').field(modeField)).toEqual({ kind: 'off', notice: null });
	});
});

describe('pickers', () => {
	it('requests only same-string-count tunings, marking the current one', () => {
		const state = tabState(['```', ...STD_ROWS, '```'], 1, 2);
		const config = { ...DEFAULT_CONFIG, tunings: [...DEFAULT_CONFIG.tunings, { name: 'Bass', strings: ['E', 'A', 'D', 'G'] }] };
		const { request } = applyAction(state, { type: 'pickTuning' }, config);
		expect(request).toEqual({ kind: 'tuning', options: DEFAULT_CONFIG.tunings, current: 'Standard' });
	});

	it('gives a notice when no tuning fits', () => {
		const result = applyAction(tabState(DOC, 1, 2), { type: 'pickTuning' }, DEFAULT_CONFIG);
		expect(result.request).toBeUndefined();
		expect(result.notice).toMatch(/2.string/);
	});

	it('requests beats for the current measure', () => {
		const { request } = applyAction(tabState(DOC, 1, 9), { type: 'pickBeats' }, DEFAULT_CONFIG);
		expect(request).toEqual({ kind: 'beats', measure: 1, current: 2 });
	});
});

describe('applyBeats', () => {
	it('clamps the cursor when the measure shrinks', () => {
		const state = applyResult(tabState(DOC, 2, 5), applyBeats(tabState(DOC, 2, 5), 1));
		expect(lines(state).slice(1, 3)).toEqual(['e|---|------|', 'B|---|------|']);
		expect(cursor(state)).toEqual({ row: 2, col: 2 });
	});

	it('keeps the cursor on the same position when an earlier measure grows', () => {
		let state = tabState(DOC, 1, 12);
		state = run(state, 'prevMeasure');
		state = applyResult(state, applyBeats(state, 3));
		expect(cursor(state)).toEqual({ row: 1, col: 2 });
		expect(lines(state)[1]).toBe('e|---------|------|');
	});
});

describe('applyTuning', () => {
	it('relabels and keeps the same position when labels get wider', () => {
		const start = tabState(DOC, 1, 5);
		const state = applyResult(start, applyTuning(start, { name: 'Wide', strings: ['Eb', 'e'] }));
		expect(lines(state).slice(1, 3)).toEqual(['e |------|------|', 'Eb|------|------|']);
		expect(cursor(state)).toEqual({ row: 1, col: 6 });
		expect(state.field(modeField).kind).toBe('tab');
		expect(currentStaff(state)?.pos).toEqual({ measure: 0, beat: 1 });
		const mode = state.field(modeField);
		expect(mode.kind !== 'off' && mode.staffFrom).toBe(state.doc.line(2).from);
	});

	it('undoes in one step', () => {
		const start = tabState(DOC, 1, 5);
		const state = applyResult(start, applyTuning(start, { name: 'Wide', strings: ['Eb', 'e'] }));
		expect(lines(runUndo(state))).toEqual(DOC);
	});
});

describe('insertStaff', () => {
	it('uses the first tuning and enters tab mode off a staff', () => {
		const state = applyResult(makeState(['text'], 0, 0), insertStaff(makeState(['text'], 0, 0), DEFAULT_CONFIG));
		expect(state.field(modeField).kind).toBe('tab');
		expect(lines(state)).toHaveLength(9);
		expect(lines(state)[2]?.startsWith('e|---')).toBe(true);
		expect(lines(state)[7]?.startsWith('E|---')).toBe(true);
		expect(cursor(state)).toEqual({ row: 2, col: 2 });
	});

	it('copies the current staff labels on newStaff', () => {
		const config = { ...DEFAULT_CONFIG, beats: 1, measures: 1 };
		const state = run(tabState(DOC, 2, 5), 'newStaff', config);
		expect(lines(state)).toEqual(['```tab', ...STAFF, '', '', 'e|---|', 'B|---|', '```']);
		expect(cursor(state)).toEqual({ row: 5, col: 2 });
		expect(currentStaff(state)?.staff.top).toBe(5);
	});

	it('gives a notice in an unclosed non-tab block and changes nothing', () => {
		const state = makeState(['```python', 'x'], 1, 0);
		const result = insertStaff(state, DEFAULT_CONFIG);
		expect(result.notice).toMatch(/close/i);
		expect(result.spec).toBeUndefined();
	});
});

describe('chord mode', () => {
	const config = {
		...DEFAULT_CONFIG,
		chords: {
			default: {
				Alpha: ['0', '2'],
				Beta: ['12', '0'],
				Gamma: ['x', '3'],
			},
		},
	};
	const chordState = (name = 'Alpha') => {
		const start = tabState(DOC, 1, 5);
		return applyResult(start, enterChord(start, name, config));
	};
	const chord = (state: ReturnType<typeof chordState>) => {
		const mode = state.field(modeField);
		return mode.kind === 'off' ? null : mode.chord;
	};
	const runC = (state: ReturnType<typeof chordState>, type: Action['type']) => run(state, type, config);

	it('gives a notice from pickShape when nothing fits, staying in tab mode', () => {
		const start = tabState(DOC, 1, 5);
		const result = applyAction(start, { type: 'pickShape' }, DEFAULT_CONFIG);
		expect(result.notice).toMatch(/shape/i);
		expect(result.request).toBeUndefined();
		expect(applyResult(start, result).field(modeField).kind).toBe('tab');
	});

	it('requests shape names in sorted order', () => {
		const { request } = applyAction(tabState(DOC, 1, 5), { type: 'pickShape' }, config);
		expect(request).toEqual({ kind: 'shape', names: ['Alpha', 'Beta', 'Gamma'] });
	});

	it('enters on the named shape at root 0', () => {
		const state = chordState('Beta');
		expect(state.field(modeField).kind).toBe('chord');
		expect(chord(state)).toMatchObject({ index: 1, root: 0, names: ['Alpha', 'Beta', 'Gamma'] });
	});

	it('wraps through shapes in both directions', () => {
		expect(chord(runC(chordState('Gamma'), 'nextShape'))?.index).toBe(0);
		expect(chord(runC(chordState('Alpha'), 'prevShape'))?.index).toBe(2);
	});

	it('keeps the root at 0 or above', () => {
		expect(chord(runC(chordState(), 'rootDown'))?.root).toBe(0);
	});

	it('caps the root so no fret exceeds 99', () => {
		let state = chordState('Beta');
		for (let i = 0; i < 100; i++) state = runC(state, 'rootUp');
		expect(chord(state)?.root).toBe(87);
	});

	it('clamps the root when moving to a shape with a lower cap', () => {
		let state = chordState('Alpha');
		for (let i = 0; i < 100; i++) state = runC(state, 'rootUp');
		expect(chord(state)?.root).toBe(97);
		expect(chord(runC(state, 'nextShape'))?.root).toBe(87);
	});

	it('writes the voicing at the root and stays in chord mode', () => {
		const state = runC(runC(chordState(), 'rootUp'), 'writeChord');
		expect(lines(state).slice(1, 3)).toEqual(['e|---3--|------|', 'B|---1--|------|']);
		expect(state.field(modeField).kind).toBe('chord');
		expect(cursor(state)).toEqual({ row: 1, col: 5 });
	});

	it('writes x for a muted string', () => {
		const state = runC(chordState('Gamma'), 'writeChord');
		expect(lines(state).slice(1, 3)).toEqual(['e|---3--|------|', 'B|---x--|------|']);
	});

	it('undoes a whole chord in one step', () => {
		expect(lines(runUndo(runC(chordState(), 'writeChord')))).toEqual(DOC);
	});

	it('returns to tab mode on exit', () => {
		const state = runC(chordState(), 'exit');
		expect(state.field(modeField).kind).toBe('tab');
		expect(chord(state)).toBeNull();
	});

	it('moves between strings and stays in chord mode', () => {
		const state = runC(chordState(), 'nextString');
		expect(cursor(state)).toEqual({ row: 2, col: 5 });
		expect(state.field(modeField).kind).toBe('chord');
	});

	describe('when the staff changes row count', () => {
		const ROW = 'G|------|------|\n';

		it('falls back to tab mode when a row is added', () => {
			const start = chordState();
			const next = start.update({ changes: { from: start.doc.line(3).from, insert: ROW } }).state;
			expect(next.field(modeField).kind).toBe('tab');
			expect(chord(next)).toBeNull();
			expect(() => buildDecorations(next, config)).not.toThrow();
		});

		it('falls back to tab mode when a row is removed', () => {
			const doc = ['```tab', ...STAFF, ROW.trim(), '```'];
			const three = { ...config, chords: { default: { Tri: ['0', '1', '2'] } } };
			const base = tabState(doc, 1, 5);
			const start = applyResult(base, enterChord(base, 'Tri', three));
			const line = start.doc.line(4);
			const next = start.update({ changes: { from: line.from - 1, to: line.to } }).state;
			expect(next.field(modeField).kind).toBe('tab');
			expect(chord(next)).toBeNull();
		});
	});

	describe('moving to another staff', () => {
		const three = ['e|---|', 'B|---|', 'G|---|'];

		it('falls back to tab mode with a notice when no shape fits', () => {
			const doc = ['```tab', ...STAFF, '', ...three, '```'];
			const start = tabState(doc, 2, 5);
			const entered = applyResult(start, enterChord(start, 'Alpha', config));
			const result = applyAction(entered, { type: 'nextString' }, config);
			expect(result.notice).toMatch(/shape/i);
			const state = applyResult(entered, result);
			expect(state.field(modeField).kind).toBe('tab');
			expect(cursor(state).row).toBe(4);
		});

		it('re-resolves shapes for the new staff, keeping the name if it exists', () => {
			const doc = ['```tab', ...STAFF, '', 'e|---|', 'E|---|', '```'];
			const tuned = {
				...config,
				tunings: [{ name: 'Low', strings: ['E', 'e'] }],
				chords: { ...config.chords, Low: { Delta: ['1', '1'] } },
			};
			const start = tabState(doc, 2, 5);
			const entered = applyResult(start, enterChord(start, 'Beta', tuned));
			const state = run(entered, 'nextString', tuned);
			expect(state.field(modeField).kind).toBe('chord');
			const next = chord(state);
			expect(next?.names).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
			expect(next?.names[next.index]).toBe('Beta');
		});
	});
});

describe('insertStaff above an existing staff', () => {
	const NOTE = ['```tab', 'Verse', ...STAFF, '```'];
	const sameLayout = { ...DEFAULT_CONFIG, beats: 2, measures: 2, tunings: [{ name: 'T', strings: ['B', 'e'] }] };

	it('keeps 2 blank lines after the new staff when the layouts match', () => {
		const state = run(makeState(NOTE, 1, 0), 'newStaff', sameLayout);
		expect(lines(state)).toEqual(['```tab', 'Verse', '', '', ...STAFF, '', '', ...STAFF, '```']);
		expect(currentStaff(state)?.staff.rows).toHaveLength(2);
		expect(cursor(state)).toEqual({ row: 4, col: 2 });
	});

	it('stays usable when the layouts differ', () => {
		const state = run(makeState(NOTE, 1, 0), 'newStaff');
		expect(currentStaff(state)?.staff.rows).toHaveLength(6);
		expect(lines(digits(state, '7'))[4]).toMatch(/^e\|7-/);
	});

	it('separates the new staff from one directly after the opening fence', () => {
		const state = run(makeState(DOC, 0, 0), 'newStaff', sameLayout);
		expect(lines(state)).toEqual(['```tab', '', '', ...STAFF, '', '', ...STAFF, '```']);
	});
});
