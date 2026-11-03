// @vitest-environment jsdom
import type { EditorState } from '@codemirror/state';
import type { Decoration, DecorationSet } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { parseStaff, type Staff } from '../../src/core/staff';
import { enterChord } from '../../src/editor/actions';
import { buildDecorations, indicatorText, legendText } from '../../src/editor/decorations';
import { applyResult, DOC, makeState, run, tabState } from './helpers';

type Found = { from: number; to: number; spec: { class?: string; block?: boolean; widget?: { text: string }; side?: number } };

function collect(set: DecorationSet, state: EditorState): Found[] {
	const found: Found[] = [];
	set.between(0, state.doc.length, (from: number, to: number, deco: Decoration) => {
		found.push({ from, to, spec: deco.spec as Found['spec'] });
	});
	return found;
}

const config = { ...DEFAULT_CONFIG, chords: { default: { Alpha: ['0', '12'], Muted: ['x', '3'] } } };
const chordState = (name = 'Alpha') => {
	const start = tabState(DOC, 1, 5);
	return applyResult(start, enterChord(start, name, config));
};

describe('indicatorText', () => {
	const parsed = parseStaff(['e|------------|------------|', 'E|------------|------------|'], 0) as { staff: Staff };

	it('shows 1-indexed measure and beat, the measure total, and the tuning', () => {
		expect(indicatorText(parsed.staff, { measure: 1, beat: 2 }, 'Standard')).toBe('m:2 b:3/4 · Standard');
	});

	it('shows Custom for an unknown tuning', () => {
		expect(indicatorText(parsed.staff, { measure: 0, beat: 0 }, 'Custom')).toBe('m:1 b:1/4 · Custom');
	});
});

describe('legendText', () => {
	it('lists the tab mode keys', () => {
		const text = legendText(tabState(DOC, 1, 2));
		for (const part of ['Space clear', 'T tuning', 'B beats', 'C chord', 'N new staff', 'Esc exit']) {
			expect(text).toContain(part);
		}
	});

	it('shows the shape, root and chord keys', () => {
		const text = legendText(run(chordState(), 'rootUp', config));
		for (const part of ['Alpha', 'root 1', 'Tab next', 'Enter insert', 'Esc back']) expect(text).toContain(part);
	});
});

describe('buildDecorations', () => {
	it('is empty when off', () => {
		const state = makeState(DOC, 1, 2);
		expect(collect(buildDecorations(state, config), state)).toEqual([]);
	});

	it('marks exactly the current measure on every row', () => {
		const state = tabState(DOC, 1, 12);
		const marks = collect(buildDecorations(state, config), state).filter((d) => d.spec.class === 'tablature-measure');
		const rows = [state.doc.line(2).from, state.doc.line(3).from];
		expect(marks.map(({ from, to }) => [from, to])).toEqual(rows.map((row) => [row + 9, row + 15]));
	});

	it('marks a row count that matches a taller staff', () => {
		const tall = ['```', ...['a', 'b', 'c', 'd', 'e'].map((l) => `${l}|---|`), '```'];
		const state = tabState(tall, 1, 2);
		const marks = collect(buildDecorations(state, config), state).filter((d) => d.spec.class === 'tablature-measure');
		expect(marks).toHaveLength(5);
	});

	it('places the indicator above the top row and the legend below the bottom row', () => {
		const state = tabState(DOC, 2, 5);
		const blocks = collect(buildDecorations(state, config), state).filter((d) => d.spec.block);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.from).toBe(state.doc.line(2).from);
		expect(blocks[0]?.spec.widget?.text).toBe('m:1 b:2/2 · Custom');
		expect(blocks[1]?.from).toBe(state.doc.line(3).to);
		expect(blocks[1]?.spec.widget?.text).toContain('Esc exit');
	});

	it('uses the matched tuning name', () => {
		const rows = ['```', ...['e', 'B', 'G', 'D', 'A', 'E'].map((l) => `${l}|---|`), '```'];
		const state = tabState(rows, 1, 2);
		const blocks = collect(buildDecorations(state, DEFAULT_CONFIG), state).filter((d) => d.spec.block);
		expect(blocks[0]?.spec.widget?.text).toContain('Standard');
	});

	it('previews the voicing over 2 characters of each row in chord mode', () => {
		const state = run(chordState(), 'rootUp', config);
		const previews = collect(buildDecorations(state, config), state).filter(
			(d) => d.spec.widget && !d.spec.block,
		);
		expect(previews.map((d) => [d.from, d.to, d.spec.widget?.text])).toEqual([
			[state.doc.line(2).from + 5, state.doc.line(2).from + 7, '13'],
			[state.doc.line(3).from + 5, state.doc.line(3).from + 7, '1-'],
		]);
	});

	it('shows no preview in tab mode', () => {
		const state = tabState(DOC, 1, 5);
		const previews = collect(buildDecorations(state, config), state).filter((d) => d.spec.widget && !d.spec.block);
		expect(previews).toEqual([]);
	});

	it('shows the chord legend, not the tab legend, in chord mode', () => {
		const state = chordState('Muted');
		const blocks = collect(buildDecorations(state, config), state).filter((d) => d.spec.block);
		expect(blocks[1]?.spec.widget?.text).toContain('Muted');
		expect(blocks[1]?.spec.widget?.text).not.toContain('Esc exit');
	});
});
