// @vitest-environment jsdom
import { history } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type Tuning } from '../../src/core/config';
import { type Action, enterAt } from '../../src/editor/actions';
import { type EditorDeps, keyPlugin, type KeyInput, resolveKey, runAction, shouldExitOnBlur } from '../../src/editor/keys';
import { modeField, OFF, selectionFilter, setMode } from '../../src/editor/mode';
import { applyResult, DOC, makeState, tabState } from './helpers';

const input = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
	key,
	ctrl: false,
	meta: false,
	alt: false,
	altGraph: false,
	shift: false,
	composing: false,
	mac: false,
	...extra,
});

const action = (type: Action['type']) => ({ kind: 'action', action: { type } });
const MOVEMENT: [string, Action['type']][] = [
	['h', 'left'],
	['ArrowLeft', 'left'],
	['l', 'right'],
	['ArrowRight', 'right'],
	['H', 'prevMeasure'],
	['{', 'prevMeasure'],
	['L', 'nextMeasure'],
	['}', 'nextMeasure'],
	['j', 'nextString'],
	['k', 'prevString'],
	['ArrowDown', 'nextString'],
	['ArrowUp', 'prevString'],
	['Escape', 'exit'],
	['q', 'exit'],
];

describe('resolveKey in tab mode', () => {
	it.each<[string, Action['type']]>([
		...MOVEMENT,
		[' ', 'clear'],
		['Backspace', 'clearLeft'],
		['T', 'pickTuning'],
		['B', 'pickBeats'],
		['C', 'pickShape'],
		['N', 'newStaff'],
	])('%j → %s', (key, type) => {
		expect(resolveKey('tab', input(key))).toEqual(action(type));
	});

	it.each(['0', '1', '5', '9'])('%s writes a digit', (digit) => {
		expect(resolveKey('tab', input(digit))).toEqual({ kind: 'action', action: { type: 'digit', digit } });
	});

	it('swallows keys it does not use', () => {
		expect(resolveKey('tab', input('z'))).toEqual({ kind: 'swallow' });
		expect(resolveKey('tab', input('Enter'))).toEqual({ kind: 'swallow' });
		expect(resolveKey('tab', input('Tab'))).toEqual({ kind: 'swallow' });
	});

	it('passes Ctrl, Cmd and Alt combinations through', () => {
		expect(resolveKey('tab', input('z', { ctrl: true }))).toEqual({ kind: 'pass' });
		expect(resolveKey('tab', input('z', { meta: true }))).toEqual({ kind: 'pass' });
		expect(resolveKey('tab', input('h', { alt: true }))).toEqual({ kind: 'pass' });
	});

	it('passes function keys and composition through', () => {
		expect(resolveKey('tab', input('F5'))).toEqual({ kind: 'pass' });
		expect(resolveKey('tab', input('5', { composing: true }))).toEqual({ kind: 'pass' });
	});

	// Review Focus 1
	it('treats AltGr as typing, even when reported as Ctrl+Alt', () => {
		expect(resolveKey('tab', input('{', { ctrl: true, alt: true, altGraph: true }))).toEqual(action('prevMeasure'));
		expect(resolveKey('tab', input('1', { altGraph: true }))).toEqual({
			kind: 'action',
			action: { type: 'digit', digit: '1' },
		});
	});

	it('treats Option as typing on macOS', () => {
		expect(resolveKey('tab', input('{', { alt: true, mac: true }))).toEqual(action('prevMeasure'));
		expect(resolveKey('tab', input('˙', { alt: true, mac: true }))).toEqual({ kind: 'swallow' });
	});

	it('still passes Option with a named key or another modifier on macOS', () => {
		expect(resolveKey('tab', input('ArrowLeft', { alt: true, mac: true }))).toEqual({ kind: 'pass' });
		expect(resolveKey('tab', input('z', { alt: true, meta: true, mac: true }))).toEqual({ kind: 'pass' });
	});

	it('matches Shift-typed digits, as on AZERTY', () => {
		expect(resolveKey('tab', input('1', { shift: true }))).toEqual({
			kind: 'action',
			action: { type: 'digit', digit: '1' },
		});
	});
});

describe('resolveKey in chord mode', () => {
	it.each<[string, Action['type']]>([
		...MOVEMENT,
		['+', 'rootUp'],
		['=', 'rootUp'],
		['-', 'rootDown'],
		['Enter', 'writeChord'],
		['C', 'pickShape'],
	])('%j → %s', (key, type) => {
		expect(resolveKey('chord', input(key))).toEqual(action(type));
	});

	it('cycles shapes with Tab and Shift+Tab', () => {
		expect(resolveKey('chord', input('Tab'))).toEqual(action('nextShape'));
		expect(resolveKey('chord', input('Tab', { shift: true }))).toEqual(action('prevShape'));
	});

	it.each(['5', 'T', 'B', 'N', ' ', 'Backspace', 'z'])('swallows %j', (key) => {
		expect(resolveKey('chord', input(key))).toEqual({ kind: 'swallow' });
	});
});

describe('shouldExitOnBlur', () => {
	it('exits when focus moved elsewhere in the window', () => {
		expect(shouldExitOnBlur(tabState(DOC, 1, 2), true)).toBe(true);
	});

	it('stays when the whole window lost focus', () => {
		expect(shouldExitOnBlur(tabState(DOC, 1, 2), false)).toBe(false);
	});

	it('stays while a picker is open', () => {
		const start = tabState(DOC, 1, 2);
		const mode = start.field(modeField);
		const open = start.update({ effects: setMode.of({ ...mode, pickerOpen: true } as never) }).state;
		expect(shouldExitOnBlur(open, true)).toBe(false);
	});

	it('does nothing when off', () => {
		expect(shouldExitOnBlur(makeState(DOC, 1, 2), true)).toBe(false);
	});
});

describe('with a real editor', () => {
	let view: EditorView | null = null;

	afterEach(() => {
		view?.destroy();
		view = null;
	});

	function deps(overrides: Partial<EditorDeps> = {}): EditorDeps {
		return {
			getConfig: () => DEFAULT_CONFIG,
			pickTuning: () => Promise.resolve(null),
			pickShape: () => Promise.resolve(null),
			promptBeats: () => Promise.resolve(null),
			notify: vi.fn(),
			isMac: false,
			...overrides,
		};
	}

	function mount(d: EditorDeps, lines = DOC): EditorView {
		const base = EditorState.create({
			doc: lines.join('\n'),
			extensions: [modeField, selectionFilter, history(), keyPlugin(d)],
		});
		const placed = base.update({ selection: { anchor: base.doc.line(2).from + 2 } }).state;
		view = new EditorView({ state: applyResult(placed, enterAt(placed, DEFAULT_CONFIG)), parent: document.body });
		return view;
	}

	function press(target: EditorView, key: string): KeyboardEvent {
		const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
		target.contentDOM.dispatchEvent(event);
		return event;
	}

	const SIX = ['```', ...['e', 'B', 'G', 'D', 'A', 'E'].map((l) => `${l}|---|`), '```'];
	const DROP: Tuning = { name: 'Drop D', strings: ['D', 'A', 'D', 'G', 'B', 'e'] };
	const settle = () => new Promise((resolve) => window.setTimeout(resolve, 0));

	it('writes a fret on a digit key and prevents the default', () => {
		const v = mount(deps());
		const event = press(v, '5');
		expect(event.defaultPrevented).toBe(true);
		expect(v.state.doc.line(2).text).toBe('e|5-----|------|');
	});

	it('does nothing when mode is off', () => {
		const v = mount(deps());
		v.dispatch({ effects: setMode.of(OFF) });
		const event = press(v, '5');
		expect(event.defaultPrevented).toBe(false);
		expect(v.state.doc.line(2).text).toBe('e|------|------|');
	});

	it('leaves a passed-through key alone', () => {
		const v = mount(deps());
		const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
		v.contentDOM.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
	});

	it('stops listening after the view is destroyed', () => {
		const v = mount(deps());
		const dom = v.contentDOM;
		v.destroy();
		view = null;
		const event = new KeyboardEvent('keydown', { key: '5', bubbles: true, cancelable: true });
		dom.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
	});

	it('stays in tab mode with an unchanged note when the tuning picker is cancelled', async () => {
		const v = mount(deps(), SIX);
		runAction(v, { type: 'pickTuning' }, deps());
		await settle();
		const mode = v.state.field(modeField);
		expect(mode.kind).toBe('tab');
		expect(mode.kind !== 'off' && mode.pickerOpen).toBe(false);
		expect(v.state.doc.toJSON()).toEqual(SIX);
	});

	it('holds pickerOpen while waiting, then relabels with the chosen tuning', async () => {
		let resolve: (t: Tuning) => void = () => undefined;
		const d = deps({ pickTuning: () => new Promise((r) => (resolve = r)) });
		const v = mount(d, SIX);
		runAction(v, { type: 'pickTuning' }, d);
		const waiting = v.state.field(modeField);
		expect(waiting.kind !== 'off' && waiting.pickerOpen).toBe(true);
		resolve(DROP);
		await settle();
		const mode = v.state.field(modeField);
		expect(mode.kind !== 'off' && mode.pickerOpen).toBe(false);
		expect(v.state.doc.line(7).text).toBe('D|---|');
	});

	it('writes nothing if the staff was deleted while the picker was open', async () => {
		let resolve: (t: Tuning) => void = () => undefined;
		const notify = vi.fn();
		const d = deps({ pickTuning: () => new Promise((r) => (resolve = r)), notify });
		const v = mount(d, SIX);
		runAction(v, { type: 'pickTuning' }, d);
		v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'gone' } });
		resolve(DROP);
		await settle();
		expect(v.state.doc.toString()).toBe('gone');
		expect(v.state.field(modeField).kind).toBe('off');
	});

	it('enters chord mode with the picked shape', async () => {
		const d = deps({ pickShape: () => Promise.resolve('G major') });
		const v = mount(d, SIX);
		runAction(v, { type: 'pickShape' }, d);
		await settle();
		expect(v.state.field(modeField).kind).toBe('chord');
	});

	it('applies a beat count from the prompt', async () => {
		const d = deps({ promptBeats: () => Promise.resolve(2) });
		const v = mount(d);
		runAction(v, { type: 'pickBeats' }, d);
		await settle();
		expect(v.state.doc.line(2).text).toBe('e|------|------|');
		const d3 = deps({ promptBeats: () => Promise.resolve(3) });
		runAction(v, { type: 'pickBeats' }, d3);
		await settle();
		expect(v.state.doc.line(2).text).toBe('e|---------|------|');
	});

	it('sends action notices to notify', () => {
		const notify = vi.fn();
		const d = deps({ notify });
		const v = mount(d);
		runAction(v, { type: 'pickTuning' }, d);
		expect(notify).toHaveBeenCalledWith(expect.stringMatching(/strings/));
	});

	it('sends the exit notice from a document change to notify, once', () => {
		const notify = vi.fn();
		const v = mount(deps({ notify }));
		v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: 'gone' } });
		v.dispatch({ changes: { from: 0, insert: 'x' } });
		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(expect.stringMatching(/staff/i));
	});
});
