import { describe, expect, it } from 'vitest';
import { generateStaff } from '../../src/core/staff';
import {
	addMissingDefaults,
	DEFAULT_CONFIG,
	formatChords,
	formatTunings,
	mergeConfig,
	parseChords,
	parseTunings,
} from '../../src/core/config';

describe('DEFAULT_CONFIG', () => {
	it('has the expected defaults', () => {
		expect(DEFAULT_CONFIG.beats).toBe(4);
		expect(DEFAULT_CONFIG.measures).toBe(4);
		expect(DEFAULT_CONFIG.tunings.map((t) => t.name)).toEqual(['Standard', 'Drop D']);
		expect(DEFAULT_CONFIG.tunings[0]?.strings).toEqual(['E', 'A', 'D', 'G', 'B', 'e']);
		expect(DEFAULT_CONFIG.chords['default']?.['Power 5th (E root)']).toEqual(['0', '2', '2', 'x', 'x', 'x']);
		expect(DEFAULT_CONFIG.chords['Standard']?.['Major (E shape)']).toEqual(['0', '2', '2', '1', '0', '0']);
		expect(DEFAULT_CONFIG.chords['Drop D']?.['Power (Drop D)']).toEqual(['0', '0', '0', 'x', 'x', 'x']);
		expect(Object.keys(DEFAULT_CONFIG.chords['Standard'] ?? {})).toHaveLength(15);
		expect(Object.keys(DEFAULT_CONFIG.chords['Drop D'] ?? {})).toHaveLength(10);
	});

	it('uses only x or numeric shape values', () => {
		for (const group of Object.values(DEFAULT_CONFIG.chords)) {
			for (const shape of Object.values(group)) {
				for (const fret of shape) expect(fret).toMatch(/^(x|\d+)$/);
			}
		}
	});
});

describe('parseTunings', () => {
	it('parses a tuning line', () => {
		expect(parseTunings('Drop D | D A D G B e')).toEqual({
			ok: true,
			value: [{ name: 'Drop D', strings: ['D', 'A', 'D', 'G', 'B', 'e'] }],
		});
	});

	it('names the bad line, counting blank lines', () => {
		expect(parseTunings('Good | E e\n\nbad line')).toMatchObject({ ok: false, line: 3 });
	});

	it('ignores blank lines', () => {
		const result = parseTunings('\nA | E e\n\nB | D e\n');
		expect(result.ok && result.value.map((t) => t.name)).toEqual(['A', 'B']);
	});

	// Review Focus 5
	it('requires at least one tuning', () => {
		const result = parseTunings('  \n');
		expect(result.ok).toBe(false);
		expect(!result.ok && result.problem).toMatch(/at least one/i);
	});

	it('rejects a label no staff could parse', () => {
		expect(parseTunings('Bad | Label1 E')).toMatchObject({ ok: false, line: 1 });
	});

	it('rejects fewer than 2 strings', () => {
		expect(parseTunings('One | E')).toMatchObject({ ok: false, line: 1 });
	});

	it('rejects an empty name', () => {
		expect(parseTunings(' | E e')).toMatchObject({ ok: false, line: 1 });
	});
});

describe('parseChords', () => {
	it('nests shapes under their scope', () => {
		expect(parseChords('Standard | Major (E shape) | 0 2 2 1 0 0')).toEqual({
			ok: true,
			value: { Standard: { 'Major (E shape)': ['0', '2', '2', '1', '0', '0'] } },
		});
	});

	it('rejects a non-numeric value', () => {
		expect(parseChords('default | Bad | 0 q')).toMatchObject({ ok: false, line: 1 });
	});

	it('rejects a fret over 99', () => {
		expect(parseChords('default | Bad | 0 100')).toMatchObject({ ok: false, line: 1 });
	});

	it('rejects the wrong number of fields', () => {
		expect(parseChords('default | 0 2')).toMatchObject({ ok: false, line: 1 });
	});

	it('allows no shapes at all', () => {
		expect(parseChords('')).toEqual({ ok: true, value: {} });
	});
});

describe('formatting', () => {
	it('round-trips the default tunings', () => {
		expect(parseTunings(formatTunings(DEFAULT_CONFIG.tunings))).toEqual({ ok: true, value: DEFAULT_CONFIG.tunings });
	});

	it('round-trips the default chords', () => {
		expect(parseChords(formatChords(DEFAULT_CONFIG.chords))).toEqual({ ok: true, value: DEFAULT_CONFIG.chords });
	});
});

describe('addMissingDefaults', () => {
	it('adds nothing to the defaults', () => {
		expect(addMissingDefaults(DEFAULT_CONFIG)).toEqual({ config: DEFAULT_CONFIG, added: 0 });
	});

	it('adds missing tunings and shapes without touching existing ones', () => {
		const old = {
			...DEFAULT_CONFIG,
			tunings: [{ name: 'Standard', strings: ['E', 'A', 'D', 'G', 'B', 'e'] }],
			bassTunings: [{ name: 'Bass drop D', strings: ['C', 'G', 'C', 'F'] }],
			chords: { default: { 'Power 5th (E root)': ['0', '2', '2', '2', 'x', 'x'] }, Mine: { Odd: ['0', '0'] } },
		};
		const { config, added } = addMissingDefaults(old);
		expect(config.tunings.map((t) => t.name)).toEqual(['Standard', 'Drop D']);
		expect(config.bassTunings).toEqual([
			{ name: 'Bass drop D', strings: ['C', 'G', 'C', 'F'] },
			{ name: 'Bass standard', strings: ['E', 'A', 'D', 'G'] },
		]);
		expect(config.chords['default']?.['Power 5th (E root)']).toEqual(['0', '2', '2', '2', 'x', 'x']);
		expect(config.chords['default']?.['Bass octave (E root)']).toEqual(['0', 'x', '2', 'x']);
		expect(config.chords['Mine']).toEqual({ Odd: ['0', '0'] });
		expect(config.chords['Standard']).toEqual(DEFAULT_CONFIG.chords['Standard']);
		expect(added).toBe(2 + Object.values(DEFAULT_CONFIG.chords).flatMap(Object.keys).length - 1);
		expect(old.chords.default).not.toHaveProperty('Bass octave (E root)');
	});
});

describe('mergeConfig', () => {
	it('returns defaults for nothing saved', () => {
		expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG);
		expect(mergeConfig('nonsense')).toEqual(DEFAULT_CONFIG);
	});

	it('keeps a saved instrument', () => {
		expect(mergeConfig({ instrument: 'bass' }).instrument).toBe('bass');
	});

	it('keeps valid saved fields', () => {
		const config = mergeConfig({ beats: 8, measures: 2 });
		expect(config.beats).toBe(8);
		expect(config.measures).toBe(2);
		expect(config.tunings).toEqual(DEFAULT_CONFIG.tunings);
	});

	it('fills in defaults an older install is missing', () => {
		const config = mergeConfig({
			tunings: [{ name: 'Standard', strings: ['E', 'A', 'D', 'G', 'B', 'e'] }],
			bassTunings: [{ name: 'Bass drop D', strings: ['D', 'A', 'D', 'G'] }],
			chords: { default: { 'Power 5th (E root)': ['0', '2', '2', 'x', 'x', 'x'] } },
		});
		expect(config.tunings.map((t) => t.name)).toEqual(['Standard', 'Drop D']);
		expect(config.bassTunings.map((t) => t.name)).toEqual(['Bass drop D', 'Bass standard']);
		expect(config.chords['default']?.['Bass octave (E root)']).toEqual(['0', 'x', '2', 'x']);
	});

	it('falls back per field when malformed', () => {
		expect(mergeConfig({ beats: 'lots' }).beats).toBe(4);
		expect(mergeConfig({ measures: 0 }).measures).toBe(4);
		expect(mergeConfig({ tunings: [] }).tunings).toEqual(DEFAULT_CONFIG.tunings);
		expect(mergeConfig({ tunings: [{ name: 'x' }] }).tunings).toEqual(DEFAULT_CONFIG.tunings);
		expect(mergeConfig({ bassTunings: [] }).bassTunings).toEqual(DEFAULT_CONFIG.bassTunings);
		expect(mergeConfig({ instrument: 'banjo' }).instrument).toBe('guitar');
		expect(mergeConfig({ chords: 3 }).chords).toEqual(DEFAULT_CONFIG.chords);
		expect(mergeConfig({ chords: { default: { Bad: ['z'] } } }).chords).toEqual(DEFAULT_CONFIG.chords);
	});
});

describe('reserved names', () => {
	const reserved = ['__proto__', 'constructor', 'prototype'];

	it.each(reserved)('rejects %s as a chord scope without polluting Object.prototype', (name) => {
		const result = parseChords(`${name} | polluted | 0 2`);
		expect(result).toMatchObject({ ok: false, line: 1 });
		expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
	});

	it.each(reserved)('rejects %s as a shape name', (name) => {
		expect(parseChords(`default | ${name} | 0 2`)).toMatchObject({ ok: false, line: 1 });
	});

	it.each(reserved)('rejects %s as a tuning name', (name) => {
		expect(parseTunings(`${name} | E e`)).toMatchObject({ ok: false, line: 1 });
	});

	it('falls back to defaults for saved data using a reserved name', () => {
		const saved = JSON.parse('{"chords":{"__proto__":{"x":["0"]}},"tunings":[{"name":"constructor","strings":["E","e"]}]}') as unknown;
		const config = mergeConfig(saved);
		expect(config.chords).toEqual(DEFAULT_CONFIG.chords);
		expect(config.tunings).toEqual(DEFAULT_CONFIG.tunings);
	});
});

describe('default staff size', () => {
	it('fits a typical pane without wrapping', () => {
		const [row] = generateStaff(DEFAULT_CONFIG.tunings[0]!.strings, DEFAULT_CONFIG.measures, DEFAULT_CONFIG.beats);
		expect(row!.length).toBeLessThanOrEqual(60);
	});
});
