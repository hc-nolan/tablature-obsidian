// THROWAWAY spike (Task 1): verifies key capture and widgets. Replaced in Task 10.
import { StateEffect, StateField, type EditorState, type Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { MarkdownView, Plugin } from 'obsidian';

const toggle = StateEffect.define<boolean>();
const capturing = StateField.define<boolean>({
	create: () => false,
	update(value, tr) {
		for (const e of tr.effects) if (e.is(toggle)) return e.value;
		return value;
	},
});

class Label extends WidgetType {
	constructor(private readonly text: string) {
		super();
	}
	toDOM(): HTMLElement {
		const el = createDiv();
		el.className = 'tablature-spike-widget';
		el.textContent = this.text;
		return el;
	}
}

function build(state: EditorState): DecorationSet {
	if (!state.field(capturing)) return Decoration.none;
	const builder = new RangeSetBuilder<Decoration>();
	const rows: { from: number; to: number }[] = [];
	for (let n = 1; n <= state.doc.lines; n++) {
		const line = state.doc.line(n);
		if (/^\S{1,4} *\|.*\|\s*$/.test(line.text)) rows.push(line);
		else if (rows.length) break;
	}
	const first = rows[0];
	const last = rows[rows.length - 1];
	if (!first || !last) return Decoration.none;
	builder.add(first.from, first.from, Decoration.widget({ widget: new Label('indicator above'), block: true, side: -1 }));
	for (const row of rows) {
		builder.add(row.from + 2, Math.min(row.from + 14, row.to), Decoration.mark({ class: 'tablature-spike-mark' }));
	}
	builder.add(last.to, last.to, Decoration.widget({ widget: new Label('legend below'), block: true, side: 1 }));
	return builder.finish();
}

const decorations = StateField.define<DecorationSet>({
	create: build,
	update: (_value, tr) => build(tr.state),
	provide: (field) => EditorView.decorations.from(field),
});

function capture(onKey: (key: string) => void): Extension {
	return ViewPlugin.define((view) => {
		const handler = (event: KeyboardEvent) => {
			if (!view.state.field(capturing)) return;
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			event.preventDefault();
			event.stopPropagation();
			onKey(event.key);
		};
		view.dom.addEventListener('keydown', handler, true);
		return { destroy: () => view.dom.removeEventListener('keydown', handler, true) };
	});
}

export default class SpikePlugin extends Plugin {
	onload(): void {
		const status = this.addStatusBarItem();
		status.setText('Spike: off');
		this.registerEditorExtension([
			capturing,
			decorations,
			capture((key) => status.setText(`Spike: last key "${key}"`)),
		]);
		this.addCommand({
			id: 'spike-toggle',
			name: 'Spike: toggle capture',
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				if (checking) return true;
				const cm = (view.editor as unknown as { cm: EditorView }).cm;
				const on = !cm.state.field(capturing);
				cm.dispatch({ effects: toggle.of(on) });
				status.setText(on ? 'Spike: capturing' : 'Spike: off');
				return true;
			},
		});
	}
}
