// Draws the measure highlight, indicator, legend and chord preview for the active staff.

import { type EditorState, type Extension, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { applyRoot, matchTuning } from '../core/chords';
import type { Config, Shape } from '../core/config';
import { BEAT_WIDTH, type Measure, posToCol, type Pos, type Staff } from '../core/staff';
import { currentStaff, modeField } from './mode';

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

export function legendText(state: EditorState): string {
	const mode = state.field(modeField);
	if (mode.kind === 'off') return '';
	if (mode.chord) {
		const name = mode.chord.names[mode.chord.index] as string;
		return `${name} · root ${mode.chord.root} · Tab next · +/- root · Enter insert · C pick · Esc back`;
	}
	return 'Space clear · T tuning · B beats · C chord · N new staff · Esc exit';
}

export function buildDecorations(state: EditorState, config: Config): DecorationSet {
	const mode = state.field(modeField);
	const info = currentStaff(state);
	if (mode.kind === 'off' || !info) return Decoration.none;
	const { staff, pos } = info;
	const measure = staff.measures[pos.measure] as Measure;
	const rowFrom = (row: number): number => state.doc.line(staff.top + row + 1).from;
	const count = staff.rows.length;
	const tuningName = matchTuning(staff, config.tunings)?.name ?? 'Custom';
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
			widget: new TextWidget(legendText(state), 'tablature-legend', 'div'),
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
			tr.docChanged || tr.selection || tr.startState.field(modeField) !== tr.state.field(modeField)
				? buildDecorations(tr.state, getConfig())
				: value,
		provide: (field) => EditorView.decorations.from(field),
	});
}
