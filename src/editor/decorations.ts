// Draws the measure highlight, indicator, legend and chord preview for the active staff.
// Host-agnostic: plain DOM only, so a host other than Obsidian can import it.

import { type EditorState, type Extension, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { applyRoot, matchTuning } from '../core/chords';
import { allTunings, type Config, type Shape } from '../core/config';
import { BEAT_WIDTH, type Measure, posToCol, type Pos, type Staff } from '../core/staff';
import { currentStaff, keysExpanded, modeField, selectedMeasures } from './mode';

const FILLER = '-';
const CELL_CONTENT_WIDTH = 2;

/** A plain element, so this file needs no host framework (Obsidian's `createEl`, Vue, …). */
function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text !== undefined) node.textContent = text;
	return node;
}

class TextWidget extends WidgetType {
	constructor(
		readonly text: string,
		private readonly className: string,
		private readonly tag: 'div' | 'span',
	) {
		super();
	}

	override eq(other: TextWidget): boolean {
		return other.text === this.text && other.className === this.className;
	}

	override toDOM(): HTMLElement {
		return el(this.tag, this.className, this.text);
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

const MOVE: LegendRow = { group: 'Move', keys: [['←→ hl', 'beat'], ['↑↓ jk', 'string'], ['{} HL', 'measure']] };

const TAB_ESSENTIALS: KeyHint[] = [['Space', 'clear'], ['C', 'chord'], ['Esc', 'exit'], MORE];
const tabAll = (isMac: boolean): LegendRow[] => [
	MOVE,
	{ group: 'Edit', keys: [['0–9', 'fret'], ['Space', 'clear'], ['⌫', 'clear left']] },
	{
		group: 'Measures',
		keys: [
			['v ⇧←→', 'select measures'],
			[isMac ? 'y ⌘C' : 'y Ctrl+C', 'copy'],
			[isMac ? 'p ⌘V' : 'p Ctrl+V', 'paste after'],
			['d Del', 'delete'],
			[':', 'repeat'],
		],
	},
	{ group: 'Staff', keys: [['T', 'tuning'], ['B', 'beats'], ['I', 'guitar/bass'], ['N', 'new staff']] },
	{ group: 'Mode', keys: [['C', 'chord'], ['Esc', 'exit'], FEWER] },
];

const CHORD_ESSENTIALS: KeyHint[] = [['Tab', 'next'], ['Enter', 'insert'], ['Esc', 'back'], MORE];
const CHORD_ALL: LegendRow[] = [
	MOVE,
	{ group: 'Shape', keys: [['Tab', 'next'], ['⇧Tab', 'previous'], ['C', 'pick']] },
	{ group: 'Root', keys: [['+', 'up'], ['-', 'down']] },

	{ group: 'Edit', keys: [['Space', 'clear beat'], ['⌫', 'clear beat left']] },
	{ group: 'Mode', keys: [['Enter', 'insert'], ['Esc', 'back'], FEWER] },
];

export function legend(state: EditorState, isMac = false): Legend {
	const mode = state.field(modeField);
	if (mode.kind === 'off') return { status: null, rows: [] };
	const all = keysExpanded(state);
	if (mode.chord) {
		const name = mode.chord.names[mode.chord.index] as string;
		const status = `${name} · root ${mode.chord.root}`;
		return { status, rows: all ? CHORD_ALL : [{ group: null, keys: CHORD_ESSENTIALS }] };
	}
	const info = mode.selectFrom === null ? null : currentStaff(state);
	if (info) {
		const [from, to] = selectedMeasures(mode, info.staff, info.pos);
		const status = from === to ? `Measure ${from + 1} selected` : `Measures ${from + 1}–${to + 1} selected`;
		const keys: KeyHint[] = [['y', 'copy'], ['d', 'delete'], ['Esc', 'cancel']];
		return { status, rows: all ? tabAll(isMac) : [{ group: null, keys }] };
	}
	return { status: null, rows: all ? tabAll(isMac) : [{ group: null, keys: TAB_ESSENTIALS }] };
}

function legendLines({ status, rows }: Legend): string {
	const lines = rows.map(({ group, keys }) =>
		[group, ...keys.map(([key, label]) => `${key} ${label}`)].filter(Boolean).join(' · '),
	);
	return [status, ...lines].filter(Boolean).join('\n');
}

/** The legend as plain text, one line per row. */
export function legendText(state: EditorState, isMac = false): string {
	return legendLines(legend(state, isMac));
}

class LegendWidget extends WidgetType {
	readonly text: string;

	constructor(readonly value: Legend) {
		super();
		this.text = legendLines(value);
	}

	override eq(other: LegendWidget): boolean {
		return JSON.stringify(other.value) === JSON.stringify(this.value);
	}

	override toDOM(): HTMLElement {
		const add = <K extends keyof HTMLElementTagNameMap>(
			parent: HTMLElement,
			tag: K,
			cls?: string,
			text?: string,
		) => parent.appendChild(el(tag, cls, text));
		const root = el('div', 'tablature-legend');
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

export function buildDecorations(state: EditorState, config: Config, isMac = false): DecorationSet {
	const mode = state.field(modeField);
	const info = currentStaff(state);
	if (mode.kind === 'off' || !info) return Decoration.none;
	const { staff, pos } = info;
	const [firstSelected, lastSelected] = selectedMeasures(mode, staff, pos);
	const first = staff.measures[firstSelected] as Measure;
	const last = staff.measures[lastSelected] as Measure;
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
		const from = rowFrom(row);
		ranges.push(
			Decoration.mark({ class: 'tablature-measure' }).range(
				from + first.start,
				from + last.start + last.beats * BEAT_WIDTH,
			),
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
			widget: new LegendWidget(legend(state, isMac)),
			block: true,
			side: 1,
		}).range(state.doc.line(staff.top + count).to),
	);

	return Decoration.set(ranges, true);
}

export function decorationsExtension(getConfig: () => Config, isMac = false): Extension {
	return StateField.define<DecorationSet>({
		create: (state) => buildDecorations(state, getConfig(), isMac),
		update: (value, tr) =>
			tr.docChanged ||
			tr.selection ||
			tr.startState.field(modeField, false) !== tr.state.field(modeField) ||
			keysExpanded(tr.startState) !== keysExpanded(tr.state)
				? buildDecorations(tr.state, getConfig(), isMac)
				: value,
		provide: (field) => EditorView.decorations.from(field),
	});
}
