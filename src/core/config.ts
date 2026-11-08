// Settings types, defaults and text formats. Pure: no editor or Obsidian dependencies.

export interface Tuning {
	name: string;
	/** Low to high. */
	strings: string[];
}

/** Low to high. Each value is 'x' or a fret number. */
export type Shape = string[];

/** Scope ('default' or a tuning name) → shape name → shape. */
export type ChordLibrary = Record<string, Record<string, Shape>>;

export type Instrument = 'guitar' | 'bass';

export interface Config {
	beats: number;
	measures: number;
	/** The instrument used when a staff is inserted from scratch. */
	instrument: Instrument;
	/** Guitar tunings. */
	tunings: Tuning[];
	bassTunings: Tuning[];
	chords: ChordLibrary;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; line: number; problem: string };

const shape = (text: string): Shape => text.split(' ');

export const DEFAULT_CONFIG: Config = {
	beats: 4,
	measures: 4,
	instrument: 'guitar',
	tunings: [
		{ name: 'Standard', strings: ['E', 'A', 'D', 'G', 'B', 'e'] },
		{ name: 'Drop D', strings: ['D', 'A', 'D', 'G', 'B', 'e'] },
	],
	bassTunings: [
		{ name: 'Bass standard', strings: ['E', 'A', 'D', 'G'] },
		{ name: 'Bass drop D', strings: ['D', 'A', 'D', 'G'] },
	],
	chords: {
		default: {
			'Power 5th (E root)': shape('0 2 2 x x x'),
			'Power 5th (A root)': shape('x 0 2 2 x x'),
			'Power 5th (D root)': shape('x x 0 2 2 x'),
			'Bass 5th (E root)': shape('0 2 x x'),
			'Bass 5th (A root)': shape('x 0 2 x'),
			'Bass 5th (D root)': shape('x x 0 2'),
			'Bass octave (E root)': shape('0 x 2 x'),
			'Bass octave (A root)': shape('x 0 x 2'),
		},
		Standard: {
			'Major (E shape)': shape('0 2 2 1 0 0'),
			'Minor (E shape)': shape('0 2 2 0 0 0'),
			'7th (E shape)': shape('0 2 0 1 0 0'),
			'Maj7 (E shape)': shape('0 2 1 1 0 0'),
			'm7 (E shape)': shape('0 2 0 0 0 0'),
			'Major (A shape)': shape('x 0 2 2 2 0'),
			'Minor (A shape)': shape('x 0 2 2 1 0'),
			'7th (A shape)': shape('x 0 2 0 2 0'),
			'Maj7 (A shape)': shape('x 0 2 1 2 0'),
			'Major (D shape)': shape('x x 0 2 3 2'),
			'Minor (D shape)': shape('x x 0 2 3 1'),
			'7th (D shape)': shape('x x 0 2 1 2'),
			'C major': shape('x 3 2 0 1 0'),
			'G major': shape('3 2 0 0 0 3'),
			G7: shape('3 2 0 0 0 1'),
		},
		'Drop D': {
			'Major (E shape)': shape('0 2 2 1 0 0'),
			'Minor (E shape)': shape('0 2 2 0 0 0'),
			'7th (E shape)': shape('0 2 0 1 0 0'),
			'Power (Drop D)': shape('0 0 0 x x x'),
			'Major (A shape)': shape('x 0 2 2 2 0'),
			'Minor (A shape)': shape('x 0 2 2 1 0'),
			'7th (A shape)': shape('x 0 2 0 2 0'),
			'Major (D shape)': shape('x x 0 2 3 2'),
			'Minor (D shape)': shape('x x 0 2 3 1'),
			'G major': shape('x 2 0 0 0 3'),
		},
	},
};

const LABEL = /^[^\s|]{1,4}$/;
const FRET = /^(x|\d{1,2})$/;
const MIN_STRINGS = 2;
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const RESERVED_PROBLEM = 'That name is reserved. Choose another.';

function isValidTuning(name: string, strings: string[]): string | null {
	if (!name) return 'The tuning needs a name.';
	if (RESERVED_NAMES.has(name)) return RESERVED_PROBLEM;
	if (strings.length < MIN_STRINGS) return 'A tuning needs at least 2 strings.';
	const bad = strings.find((label) => !LABEL.test(label));
	return bad === undefined ? null : `"${bad}" isn't a usable label: labels are 1 to 4 characters.`;
}

function isValidShape(values: string[]): string | null {
	if (values.length === 0) return 'The shape has no frets.';
	const bad = values.find((value) => !FRET.test(value));
	return bad === undefined ? null : `"${bad}" isn't valid: use x or a fret from 0 to 99.`;
}

const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);
const fields = (line: string): string[] => line.split('|').map((field) => field.trim());

export function parseTunings(text: string): Parsed<Tuning[]> {
	const tunings: Tuning[] = [];
	for (const [i, line] of text.split('\n').entries()) {
		if (!line.trim()) continue;
		const parts = fields(line);
		if (parts.length !== 2) return { ok: false, line: i + 1, problem: 'Use the format: name | E A D G B e' };
		const name = parts[0] as string;
		const strings = words(parts[1] as string);
		const problem = isValidTuning(name, strings);
		if (problem) return { ok: false, line: i + 1, problem };
		tunings.push({ name, strings });
	}
	if (tunings.length === 0) return { ok: false, line: 1, problem: 'At least one tuning is required.' };
	return { ok: true, value: tunings };
}

export function parseChords(text: string): Parsed<ChordLibrary> {
	const chords: ChordLibrary = {};
	for (const [i, line] of text.split('\n').entries()) {
		if (!line.trim()) continue;
		const parts = fields(line);
		if (parts.length !== 3 || !parts[0] || !parts[1]) {
			return { ok: false, line: i + 1, problem: 'Use the format: default or tuning name | shape name | 0 2 2 x x x' };
		}
		if (RESERVED_NAMES.has(parts[0]) || RESERVED_NAMES.has(parts[1])) {
			return { ok: false, line: i + 1, problem: RESERVED_PROBLEM };
		}
		const values = words(parts[2] as string);
		const problem = isValidShape(values);
		if (problem) return { ok: false, line: i + 1, problem };
		(chords[parts[0]] ??= {})[parts[1]] = values;
	}
	return { ok: true, value: chords };
}

export function formatTunings(tunings: Tuning[]): string {
	return tunings.map(({ name, strings }) => `${name} | ${strings.join(' ')}`).join('\n');
}

export function formatChords(chords: ChordLibrary): string {
	return Object.entries(chords)
		.flatMap(([scope, group]) =>
			Object.entries(group).map(([name, values]) => `${scope} | ${name} | ${values.join(' ')}`),
		)
		.join('\n');
}

function isPositiveInt(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 1;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validTunings(value: unknown): Tuning[] | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	const ok = value.every((item) => {
		const tuning = asRecord(item);
		return (
			!!tuning &&
			typeof tuning['name'] === 'string' &&
			isStringArray(tuning['strings']) &&
			!isValidTuning(tuning['name'], tuning['strings'])
		);
	});
	return ok ? (value as Tuning[]) : null;
}

function validChords(value: unknown): ChordLibrary | null {
	const library = asRecord(value);
	if (!library) return null;
	const ok = Object.entries(library).every(([scope, group]) => {
		const shapes = asRecord(group);
		if (RESERVED_NAMES.has(scope) || !shapes) return false;
		return Object.entries(shapes).every(
			([name, s]) => !RESERVED_NAMES.has(name) && isStringArray(s) && !isValidShape(s),
		);
	});
	return ok ? (library as ChordLibrary) : null;
}

export function mergeConfig(saved: unknown): Config {
	const data = asRecord(saved) ?? {};
	return {
		beats: isPositiveInt(data['beats']) ? data['beats'] : DEFAULT_CONFIG.beats,
		measures: isPositiveInt(data['measures']) ? data['measures'] : DEFAULT_CONFIG.measures,
		instrument: data['instrument'] === 'bass' ? 'bass' : 'guitar',
		tunings: validTunings(data['tunings']) ?? DEFAULT_CONFIG.tunings,
		bassTunings: validTunings(data['bassTunings']) ?? DEFAULT_CONFIG.bassTunings,
		chords: validChords(data['chords']) ?? DEFAULT_CONFIG.chords,
	};
}

export function allTunings(config: Config): Tuning[] {
	return [...config.tunings, ...config.bassTunings];
}

/** The default tuning for new staves of an instrument: the first in its list. */
export function defaultTuning(config: Config, instrument: Instrument): Tuning {
	return (instrument === 'bass' ? config.bassTunings[0] : config.tunings[0]) as Tuning;
}

/**
 * Adds every default tuning and chord shape whose name isn't already in use, so an install whose settings predate
 * new defaults can pick them up. Existing entries are never changed.
 */
export function addMissingDefaults(config: Config): { config: Config; added: number } {
	let added = 0;
	const names = new Set(allTunings(config).map(({ name }) => name));
	const missing = (defaults: Tuning[]): Tuning[] => {
		const extra = defaults.filter(({ name }) => !names.has(name));
		added += extra.length;
		return extra;
	};
	const tunings = [...config.tunings, ...missing(DEFAULT_CONFIG.tunings)];
	const bassTunings = [...config.bassTunings, ...missing(DEFAULT_CONFIG.bassTunings)];

	const chords: ChordLibrary = Object.fromEntries(
		Object.entries(config.chords).map(([scope, group]) => [scope, { ...group }]),
	);
	for (const [scope, group] of Object.entries(DEFAULT_CONFIG.chords)) {
		for (const [name, values] of Object.entries(group)) {
			const target = (chords[scope] ??= {});
			if (Object.prototype.hasOwnProperty.call(target, name)) continue;
			target[name] = [...values];
			added++;
		}
	}
	return { config: { ...config, tunings, bassTunings, chords }, added };
}
