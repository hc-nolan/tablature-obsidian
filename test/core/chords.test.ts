import { describe, expect, it } from 'vitest';
import { applyRoot, availableShapes, matchTuning, maxRoot, writeVoicing } from '../../src/core/chords';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { generateStaff, type LineEdit, parseStaff, type Staff } from '../../src/core/staff';

function parsed(rows: string[]): Staff {
	const result = parseStaff(rows, 0);
	if (!result.ok) throw new Error(result.problem);
	return result.staff;
}

function apply(rows: string[], edits: LineEdit[]): string[] {
	const out = [...rows];
	for (const edit of edits) {
		const row = out[edit.row] as string;
		out[edit.row] = row.slice(0, edit.from) + edit.insert + row.slice(edit.to);
	}
	return out;
}

const standard = parsed(generateStaff(['E', 'A', 'D', 'G', 'B', 'e'], 1, 4));
const dropD = parsed(generateStaff(['D', 'A', 'D', 'G', 'B', 'e'], 1, 4));
const POS = { measure: 0, beat: 0 };

describe('matchTuning', () => {
	it('matches labels low to high', () => {
		expect(matchTuning(standard, DEFAULT_CONFIG.tunings)?.name).toBe('Standard');
		expect(matchTuning(dropD, DEFAULT_CONFIG.tunings)?.name).toBe('Drop D');
	});

	it('matches through padding', () => {
		const tunings = [{ name: 'Eb', strings: ['Eb', 'e'] }];
		expect(matchTuning(parsed(generateStaff(['Eb', 'e'], 1, 1)), tunings)?.name).toBe('Eb');
	});

	it('returns null for unknown labels', () => {
		expect(matchTuning(parsed(generateStaff(['X', 'Y'], 1, 1)), DEFAULT_CONFIG.tunings)).toBeNull();
	});
});

describe('availableShapes', () => {
	it('lets the tuning win over default on a collision', () => {
		const config = {
			...DEFAULT_CONFIG,
			chords: {
				default: { Same: ['0', '0', '0', '0', '0', '0'] },
				Standard: { Same: ['1', '1', '1', '1', '1', '1'] },
			},
		};
		expect(availableShapes(standard, config)['Same']?.[0]).toBe('1');
	});

	it('uses the Drop D library on a Drop D staff, plus defaults', () => {
		const shapes = availableShapes(dropD, DEFAULT_CONFIG);
		expect(shapes['G major']).toEqual(['x', '2', '0', '0', '0', '3']);
		expect(shapes['Power 5th (E root)']).toBeDefined();
		expect(shapes['C major']).toBeUndefined();
	});

	it('filters to the string count', () => {
		const fourString = parsed(generateStaff(['E', 'A', 'D', 'G'], 1, 1));
		expect(availableShapes(fourString, DEFAULT_CONFIG)).toEqual({});
	});

	it('uses only default shapes on an unknown tuning', () => {
		const custom = parsed(generateStaff(['C', 'G', 'C', 'G', 'C', 'E'], 1, 1));
		expect(Object.keys(availableShapes(custom, DEFAULT_CONFIG))).toHaveLength(3);
	});
});

describe('applyRoot', () => {
	it('adds the root and leaves muted strings', () => {
		expect(applyRoot(['0', '2', 'x'], 3)).toEqual(['3', '5', 'x']);
	});

	it('is identity at root 0', () => {
		expect(applyRoot(['x', '0', '2'], 0)).toEqual(['x', '0', '2']);
	});

	it('handles double-digit results', () => {
		expect(applyRoot(['0', '2'], 10)).toEqual(['10', '12']);
	});
});

describe('maxRoot', () => {
	it('keeps the highest fret at or below 99', () => {
		expect(maxRoot(['0', '2', 'x'])).toBe(97);
		expect(maxRoot(['12', '0'])).toBe(87);
		expect(maxRoot(['x', 'x'])).toBe(99);
	});
});

describe('writeVoicing', () => {
	it('maps low-to-high voicing onto top-to-bottom rows', () => {
		const out = apply(standard.rows, writeVoicing(standard, POS, ['0', '0', '2', '2', '2', '3']));
		expect(out.map((row) => row.slice(2, 4))).toEqual(['3-', '2-', '2-', '2-', '0-', '0-']);
	});

	it('writes x for muted strings', () => {
		const rows = generateStaff(['E', 'e'], 1, 1);
		expect(apply(rows, writeVoicing(parsed(rows), POS, ['x', '12']))).toEqual(['e|12-|', 'E|x--|']);
	});

	it('leaves no stray digit over a double-digit fret', () => {
		const rows = ['e|12-------|', 'E|---------|'];
		expect(apply(rows, writeVoicing(parsed(rows), POS, ['0', '5']))[0]).toBe('e|5--------|');
	});

	it('writes at the right beat', () => {
		const rows = generateStaff(['E', 'e'], 1, 2);
		const out = apply(rows, writeVoicing(parsed(rows), { measure: 0, beat: 1 }, ['5', '5']));
		expect(out[0]).toBe('e|---5--|');
	});
});
