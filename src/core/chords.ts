// Tuning matching and chord voicings. Pure: no editor or Obsidian dependencies.

import { allTunings, type Config, type Shape, type Tuning } from './config';
import { cellEdit, type LineEdit, type Pos, type Staff, staffLabelsLowToHigh } from './staff';

const MAX_FRET = 99;

export function matchTuning(staff: Staff, tunings: Tuning[]): Tuning | null {
	const labels = staffLabelsLowToHigh(staff);
	return (
		tunings.find(
			({ strings }) => strings.length === labels.length && strings.every((label, i) => label === labels[i]),
		) ?? null
	);
}

export function availableShapes(staff: Staff, config: Config): Record<string, Shape> {
	const tuning = matchTuning(staff, allTunings(config));
	const merged = { ...config.chords['default'], ...(tuning ? config.chords[tuning.name] : undefined) };
	return Object.fromEntries(Object.entries(merged).filter(([, shape]) => shape.length === staff.rows.length));
}

export function applyRoot(shape: Shape, root: number): string[] {
	return shape.map((value) => (value === 'x' ? value : String(Number(value) + root)));
}

export function maxRoot(shape: Shape): number {
	const frets = shape.filter((value) => value !== 'x').map(Number);
	return MAX_FRET - Math.max(0, ...frets);
}

export function writeVoicing(staff: Staff, pos: Pos, voicing: string[]): LineEdit[] {
	const count = staff.rows.length;
	return staff.rows.map((_, row) => cellEdit(staff, row, pos, voicing[count - 1 - row] as string));
}
