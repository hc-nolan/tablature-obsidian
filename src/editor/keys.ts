// Routes key presses to actions while tab or chord mode is active.

import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import type { Config, Tuning } from '../core/config';
import { type Action, type ActionResult, applyAction, applyBeats, applyTuning, enterChord, type PickerRequest } from './actions';
import { modeField, OFF, setMode } from './mode';

export interface KeyInput {
	key: string;
	ctrl: boolean;
	meta: boolean;
	alt: boolean;
	altGraph: boolean;
	shift: boolean;
	composing: boolean;
}

export type KeyResult = { kind: 'pass' } | { kind: 'swallow' } | { kind: 'action'; action: Action };

export interface EditorDeps {
	getConfig(): Config;
	pickTuning(options: Tuning[], current: string | null): Promise<Tuning | null>;
	pickShape(names: string[]): Promise<string | null>;
	promptBeats(measure: number, current: number): Promise<number | null>;
	notify(message: string): void;
}

const MOVEMENT: Record<string, Action['type']> = {
	h: 'left',
	ArrowLeft: 'left',
	l: 'right',
	ArrowRight: 'right',
	H: 'prevMeasure',
	'{': 'prevMeasure',
	L: 'nextMeasure',
	'}': 'nextMeasure',
	j: 'nextString',
	k: 'prevString',
	Escape: 'exit',
	q: 'exit',
};

const TAB_KEYS: Record<string, Action['type']> = {
	...MOVEMENT,
	' ': 'clear',
	Backspace: 'clearLeft',
	T: 'pickTuning',
	B: 'pickBeats',
	C: 'pickShape',
	N: 'newStaff',
};

const CHORD_KEYS: Record<string, Action['type']> = {
	...MOVEMENT,
	Tab: 'nextShape',
	'+': 'rootUp',
	'=': 'rootUp',
	'-': 'rootDown',
	Enter: 'writeChord',
	C: 'pickShape',
};

export function resolveKey(mode: 'tab' | 'chord', input: KeyInput): KeyResult {
	if (input.composing || /^F\d+$/.test(input.key)) return { kind: 'pass' };
	// AltGr types characters such as { on many layouts, and some platforms report it as Ctrl+Alt.
	if (!input.altGraph && (input.ctrl || input.meta || input.alt)) return { kind: 'pass' };

	if (mode === 'tab' && /^\d$/.test(input.key)) return { kind: 'action', action: { type: 'digit', digit: input.key } };
	if (mode === 'chord' && input.key === 'Tab' && input.shift) return { kind: 'action', action: { type: 'prevShape' } };

	const keys = mode === 'tab' ? TAB_KEYS : CHORD_KEYS;
	const type = Object.prototype.hasOwnProperty.call(keys, input.key) ? keys[input.key] : undefined;
	return type ? { kind: 'action', action: { type } as Action } : { kind: 'swallow' };
}

export function shouldExitOnBlur(state: EditorState, windowHasFocus: boolean): boolean {
	const mode = state.field(modeField);
	return mode.kind !== 'off' && !mode.pickerOpen && windowHasFocus;
}

function setPickerOpen(view: EditorView, pickerOpen: boolean): void {
	const mode = view.state.field(modeField);
	if (mode.kind !== 'off') view.dispatch({ effects: setMode.of({ ...mode, pickerOpen }) });
}

function applyResult(view: EditorView, result: ActionResult, deps: EditorDeps): void {
	if (result.spec) view.dispatch(result.spec);
	if (result.notice) deps.notify(result.notice);
}

async function runRequest(view: EditorView, request: PickerRequest, deps: EditorDeps): Promise<void> {
	setPickerOpen(view, true);
	let followUp: ((state: EditorState) => ActionResult) | null = null;
	try {
		if (request.kind === 'tuning') {
			const tuning = await deps.pickTuning(request.options, request.current);
			if (tuning) followUp = (state) => applyTuning(state, tuning);
		} else if (request.kind === 'beats') {
			const beats = await deps.promptBeats(request.measure, request.current);
			if (beats !== null) followUp = (state) => applyBeats(state, beats);
		} else {
			const name = await deps.pickShape(request.names);
			if (name !== null) followUp = (state) => enterChord(state, name, deps.getConfig());
		}
	} finally {
		setPickerOpen(view, false);
		view.focus();
	}
	// The note may have changed while the picker was open; these re-read the staff and no-op if it's gone.
	if (followUp) applyResult(view, followUp(view.state), deps);
}

export function runAction(view: EditorView, action: Action, deps: EditorDeps): void {
	const result = applyAction(view.state, action, deps.getConfig());
	applyResult(view, result, deps);
	if (result.request) void runRequest(view, result.request, deps);
}

export function keyPlugin(deps: EditorDeps): Extension {
	return ViewPlugin.define(
		(view) => {
			const onKeydown = (event: KeyboardEvent): void => {
				const mode = view.state.field(modeField);
				if (mode.kind === 'off' || mode.pickerOpen) return;
				if (!view.contentDOM.contains(event.target as Node)) return;
				const result = resolveKey(mode.kind, {
					key: event.key,
					ctrl: event.ctrlKey,
					meta: event.metaKey,
					alt: event.altKey,
					altGraph: event.getModifierState('AltGraph'),
					shift: event.shiftKey,
					composing: event.isComposing,
				});
				if (result.kind === 'pass') return;
				event.preventDefault();
				event.stopPropagation();
				if (result.kind === 'action') runAction(view, result.action, deps);
			};

			const onBlur = (): void => {
				queueMicrotask(() => {
					if (!view.hasFocus && shouldExitOnBlur(view.state, view.dom.ownerDocument.hasFocus())) {
						view.dispatch({ effects: setMode.of(OFF) });
					}
				});
			};

			// Capture phase, on an ancestor of contentDOM, so tab mode sees keys before Obsidian's Vim layer.
			view.dom.addEventListener('keydown', onKeydown, true);
			view.contentDOM.addEventListener('blur', onBlur);
			return {
				update(update) {
					const before = update.startState.field(modeField);
					const after = update.state.field(modeField);
					if (before !== after && after.kind === 'off' && after.notice) deps.notify(after.notice);
				},
				destroy() {
					view.dom.removeEventListener('keydown', onKeydown, true);
					view.contentDOM.removeEventListener('blur', onBlur);
				},
			};
		},
	);
}
