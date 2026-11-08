// Draws the measure highlight, indicator, legend and chord preview for the active staff.

import { type EditorState, type Extension, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { applyRoot, matchTuning } from '../core/chords';
import { allTunings, type Config, type Shape } from '../core/config';
import { BEAT_WIDTH, type Measure, posToCol, type Pos, type Staff } from '../core/staff';
import { currentStaff, keysExpanded, modeField } from './mode';

const FILLER = '-';
const CELL_CONTENT_WIDTH = 2;

class TextWidget extends WidgetType {
	constructor(
		readonly text: string,
		private readonly className: string,
		private readonly tag: 'div' | 'span',
	) {
		super();
	}

	eq(other: TextWidget): boolean {
		return other.text === this.text && other.className === this.className;
	}

	toDOM(): HTMLElement {
		return createEl(this.tag, { cls: this.className, text: this.text });
	}
}

export function indicatorText(staff: Staff, pos: Pos, tuningName: string): string {
	const beats = (staff.measures[pos.measure] as Measure).beats;
	return `m:${pos.measure + 1} b:${pos.beat + 1}/${beats} · ${tuningName}`;
}

/** A key and what it does. */
export type KeyHint = [key: string, label: string];

export interface LegendRow {
	/** A group name such as "Edit", or null for an ungrouped row. */
	group: string | null;
	keys: KeyHint[];
}

export interface Legend {
	/** Chord mode's shape and root. */
	status: string | null;
	rows: LegendRow[];
}

const MORE: KeyHint = ['?', 'more keys'];
const FEWER: KeyHint = ['?', 'fewer keys'];

const TAB_ESSENTIALS: KeyHint[] = [['Space', 'clear'], ['C', 'chord'], ['Esc', 'exit'], MORE];
const TAB_ALL: LegendRow[] = [
	{ group: 'Edit', keys: [['0–9', 'fret'], ['Space', 'clear'], ['⌫', 'clear left']] },
	{ group: 'Staff', keys: [['T', 'tuning'], ['B', 'beats'], ['I', 'guitar/bass'], ['N', 'new staff']] },
	{ group: 'Mode', keys: [['C', 'chord'], ['Esc', 'exit'], FEWER] },
];

const CHORD_ESSENTIALS: KeyHint[] = [['Tab', 'next'], ['Enter', 'insert'], ['Esc', 'back'], MORE];
const CHORD_ALL: LegendRow[] = [
	{ group: 'Shape', keys: [['Tab', 'next'], ['⇧Tab', 'previous'], ['C', 'pick']] },
	{ group: 'Root', keys: [['+', 'up'], ['-', 'down']] },
	{ group: 'Mode', keys: [['Enter', 'insert'], ['Esc', 'back'], FEWER] },
];

export function legend(state: EditorState): Legend {
	const mode = state.field(modeField);
	if (mode.kind === 'off') return { status: null, rows: [] };
	const all = keysExpanded(state);
	if (mode.chord) {
		const name = mode.chord.names[mode.chord.index] as string;
		const status = `${name} · root ${mode.chord.root}`;
		return { status, rows: all ? CHORD_ALL : [{ group: null, keys: CHORD_ESSENTIALS }] };
	}
	return { status: null, rows: all ? TAB_ALL : [{ group: null, keys: TAB_ESSENTIALS }] };
}

/** The legend as plain text, one line per row. */
export function legendText(state: EditorState): string {
	const { status, rows } = legend(state);
	const lines = rows.map(({ group, keys }) =>
		[group, ...keys.map(([key, label]) => `${key} ${label}`)].filter(Boolean).join(' · '),
	);
	return [status, ...lines].filter(Boolean).join('\n');
}

class LegendWidget extends WidgetType {
	constructor(
		readonly value: Legend,
		readonly text: string,
	) {
		super();
	}

	eq(other: LegendWidget): boolean {
		return other.text === this.text;
	}

	toDOM(): HTMLElement {
		const add = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string) =>
			parent.appendChild(createEl(tag, { cls, text }));
		const root = createDiv({ cls: 'tablature-legend' });
		if (this.value.status) add(root, 'div', 'tablature-legend-status', this.value.status);
		for (const { group, keys } of this.value.rows) {
			const row = add(root, 'div', 'tablature-legend-row');
			if (group) add(row, 'span', 'tablature-legend-group', group);
			for (const [key, label] of keys) {
				const hint = add(row, 'span', 'tablature-legend-hint');
				add(hint, 'kbd', undefined, key);
				add(hint, 'span', undefined, label);
			}
		}
		return root;
	}
}

export function buildDecorations(state: EditorState, config: Config): DecorationSet {
	const mode = state.field(modeField);
	const info = currentStaff(state);
	if (mode.kind === 'off' || !info) return Decoration.none;
	const { staff, pos } = info;
	const measure = staff.measures[pos.measure] as Measure;
	const rowFrom = (row: number): number => state.doc.line(staff.top + row + 1).from;
	const count = staff.rows.length;
	const tuningName = matchTuning(staff, allTunings(config))?.name ?? 'Custom';
	const ranges = [];

	ranges.push(
		Decoration.widget({
			widget: new TextWidget(indicatorText(staff, pos, tuningName), 'tablature-indicator', 'div'),
			block: true,
			side: -1,
		}).range(rowFrom(0)),
	);

	for (let row = 0; row < count; row++) {
		const from = rowFrom(row) + measure.start;
		ranges.push(
			Decoration.mark({ class: 'tablature-measure' }).range(from, from + measure.beats * BEAT_WIDTH),
		);
	}

	if (mode.chord) {
		const shape = mode.chord.shapes[mode.chord.names[mode.chord.index] as string] as Shape;
		const voicing = applyRoot(shape, mode.chord.root);
		const col = posToCol(staff, pos);
		for (let row = 0; row < count; row++) {
			const from = rowFrom(row) + col;
			const text = (voicing[count - 1 - row] as string).padEnd(CELL_CONTENT_WIDTH, FILLER);
			ranges.push(
				Decoration.replace({ widget: new TextWidget(text, 'tablature-preview', 'span') }).range(
					from,
					from + CELL_CONTENT_WIDTH,
				),
			);
		}
	}

	ranges.push(
		Decoration.widget({
			widget: new LegendWidget(legend(state), legendText(state)),
			block: true,
			side: 1,
		}).range(state.doc.line(staff.top + count).to),
	);

	return Decoration.set(ranges, true);
}

export function decorationsExtension(getConfig: () => Config): Extension {
	return StateField.define<DecorationSet>({
		create: (state) => buildDecorations(state, getConfig()),
		update: (value, tr) =>
			tr.docChanged ||
			tr.selection ||
			tr.startState.field(modeField, false) !== tr.state.field(modeField) ||
			keysExpanded(tr.startState) !== keysExpanded(tr.state)
				? buildDecorations(tr.state, getConfig())
				: value,
		provide: (field) => EditorView.decorations.from(field),
	});
}
