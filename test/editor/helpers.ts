import { history, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { type Action, type ActionResult, applyAction, enterAt } from '../../src/editor/actions';
import { DEFAULT_CONFIG, type Config } from '../../src/core/config';
import { modeField, selectionFilter } from '../../src/editor/mode';

export const STAFF = ['e|------|------|', 'B|------|------|'];
export const DOC = ['```tab', ...STAFF, '```'];

export function makeState(lines: string[], row: number, col: number): EditorState {
	const state = EditorState.create({
		doc: lines.join('\n'),
		extensions: [modeField, selectionFilter, history(), EditorState.allowMultipleSelections.of(true)],
	});
	return state.update({ selection: { anchor: state.doc.line(row + 1).from + col } }).state;
}

export function applyResult(state: EditorState, result: ActionResult): EditorState {
	return result.spec ? state.update(result.spec).state : state;
}

export function enter(state: EditorState, config: Config = DEFAULT_CONFIG): EditorState {
	return applyResult(state, enterAt(state, config));
}

/** An editor in tab mode with the cursor on the given cell. */
export function tabState(lines: string[], row: number, col: number): EditorState {
	return enter(makeState(lines, row, col));
}

export function run(state: EditorState, action: Action | Action['type'], config: Config = DEFAULT_CONFIG): EditorState {
	return applyResult(state, applyAction(state, typeof action === 'string' ? ({ type: action } as Action) : action, config));
}

export function digits(state: EditorState, text: string): EditorState {
	return [...text].reduce((s, digit) => run(s, { type: 'digit', digit }), state);
}

export function runUndo(state: EditorState): EditorState {
	let next = state;
	undo({ state, dispatch: (tr) => (next = tr.state) });
	return next;
}

export function click(state: EditorState, row: number, col: number): EditorState {
	const anchor = state.doc.line(row + 1).from + col;
	return state.update({ selection: { anchor }, userEvent: 'select.pointer' }).state;
}

export function cursor(state: EditorState): { row: number; col: number } {
	const head = state.selection.main.head;
	const line = state.doc.lineAt(head);
	return { row: line.number - 1, col: head - line.from };
}

export function lines(state: EditorState): string[] {
	return state.doc.toJSON();
}
