// Turns mode actions into transactions. No DOM or Obsidian access, so all of this runs against a plain EditorState.

import { isolateHistory } from '@codemirror/commands';
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { nextStaff, planInsertStaff, prevStaff, type StaffRange } from '../core/blocks';
import { applyRoot, availableShapes, matchTuning, maxRoot, writeVoicing } from '../core/chords';
import { allTunings, type Config, defaultTuning, type Instrument, type Shape, type Tuning } from '../core/config';
import {
	clampPos,
	clearCell,
	type LineEdit,
	type Measure,
	parseStaff,
	posToCol,
	type Pos,
	relabel,
	restring,
	setMeasureBeats,
	type Staff,
	staffLabelsLowToHigh,
	writeFret,
} from '../core/staff';
import {
	type ActiveMode,
	type ChordState,
	currentStaff,
	modeField,
	OFF,
	parseStaffAtRow,
	setMode,
	toChanges,
	toggleKeys,
} from './mode';

export type Action =
	| {
			type:
				| 'left'
				| 'right'
				| 'prevMeasure'
				| 'nextMeasure'
				| 'nextString'
				| 'prevString'
				| 'clear'
				| 'clearLeft'
				| 'pickTuning'
				| 'pickBeats'
				| 'pickShape'
				| 'newStaff'
				| 'swapInstrument'
				| 'toggleKeys'
				| 'exit';
	  }
	| { type: 'digit'; digit: string }
	| { type: 'nextShape' | 'prevShape' | 'rootUp' | 'rootDown' | 'writeChord' };

export type PickerRequest =
	| { kind: 'tuning'; options: Tuning[]; current: string | null }
	| { kind: 'beats'; measure: number; current: number }
	| { kind: 'shape'; names: string[] };

export interface ActionResult {
	spec?: TransactionSpec;
	notice?: string;
	request?: PickerRequest;
}

function cursorAt(state: EditorState, staff: Staff, stringRow: number, pos: Pos): EditorSelection {
	const lineFrom = state.doc.line(staff.top + stringRow + 1).from;
	return EditorSelection.single(lineFrom + posToCol(staff, pos));
}

function moveTo(state: EditorState, mode: ActiveMode, staff: Staff, stringRow: number, pos: Pos): ActionResult {
	return {
		spec: {
			selection: cursorAt(state, staff, stringRow, pos),
			scrollIntoView: true,
			effects: setMode.of({ ...mode, pending: false }),
		},
	};
}

/** Applies edits as one undo step, then puts the cursor on `pos` as re-read from the edited text. */
function editSpec(
	state: EditorState,
	mode: ActiveMode,
	staff: Staff,
	edits: LineEdit[],
	stringRow: number,
	pos: Pos,
	pending: boolean,
): ActionResult {
	const changes = state.changes(toChanges(state, edits));
	const doc = changes.apply(state.doc);
	const reparsed = parseStaffAtRow(doc, staff.top);
	if (!reparsed?.ok) return { notice: reparsed?.problem ?? 'That edit would break the staff.' };
	const edited = reparsed.staff;
	return {
		spec: {
			changes,
			selection: EditorSelection.single(
				doc.line(edited.top + stringRow + 1).from + posToCol(edited, clampPos(edited, pos)),
			),
			scrollIntoView: true,
			annotations: isolateHistory.of('full'),
			effects: setMode.of({ ...mode, pending, pickerOpen: false }),
		},
	};
}

function posLeft(staff: Staff, pos: Pos): Pos {
	if (pos.beat > 0) return { measure: pos.measure, beat: pos.beat - 1 };
	if (pos.measure === 0) return pos;
	return { measure: pos.measure - 1, beat: (staff.measures[pos.measure - 1] as Measure).beats - 1 };
}

function posRight(staff: Staff, pos: Pos): Pos {
	if (pos.beat + 1 < (staff.measures[pos.measure] as Measure).beats) {
		return { measure: pos.measure, beat: pos.beat + 1 };
	}
	return pos.measure + 1 < staff.measures.length ? { measure: pos.measure + 1, beat: 0 } : pos;
}

function clampRoot(chord: ChordState): ChordState {
	const shape = chord.shapes[chord.names[chord.index] as string] as Shape;
	return { ...chord, root: Math.max(0, Math.min(maxRoot(shape), chord.root)) };
}

function switchStaff(
	state: EditorState,
	mode: ActiveMode,
	range: StaffRange,
	stringRow: number,
	pos: Pos,
	config: Config,
): ActionResult {
	const parsed = parseStaff(state.doc.toJSON().slice(range.top, range.top + range.height), range.top);
	if (!parsed.ok) return { notice: parsed.problem };
	const staffFrom = state.doc.line(range.top + 1).from;
	const target = clampPos(parsed.staff, pos);
	if (!mode.chord) return moveTo(state, { ...mode, staffFrom }, parsed.staff, stringRow, target);

	const shapes = availableShapes(parsed.staff, config);
	const names = Object.keys(shapes).sort();
	if (names.length === 0) {
		const tab: ActiveMode = { ...mode, kind: 'tab', chord: null, staffFrom };
		return {
			...moveTo(state, tab, parsed.staff, stringRow, target),
			notice: `No chord shapes fit this staff, so chord mode has ended.`,
		};
	}
	const index = Math.max(0, names.indexOf(mode.chord.names[mode.chord.index] as string));
	const chord = clampRoot({ names, shapes, index, root: mode.chord.root });
	return moveTo(state, { ...mode, chord, staffFrom }, parsed.staff, stringRow, target);
}

function setChord(mode: ActiveMode, chord: ChordState): ActionResult {
	return { spec: { effects: setMode.of({ ...mode, chord: clampRoot(chord) }) } };
}

export function enterChord(state: EditorState, shapeName: string, config: Config): ActionResult {
	const mode = state.field(modeField);
	const info = currentStaff(state);
	if (mode.kind === 'off' || !info) return {};
	const shapes = availableShapes(info.staff, config);
	const names = Object.keys(shapes).sort();
	const index = names.indexOf(shapeName);
	if (index < 0) return { notice: `The shape "${shapeName}" doesn't fit this staff.` };
	return { spec: { effects: setMode.of({ ...mode, kind: 'chord', pending: false, chord: { names, shapes, index, root: 0 } }) } };
}

export function enterAt(state: EditorState, config: Config): ActionResult {
	const head = state.selection.main.head;
	const line = state.doc.lineAt(head);
	const parsed = parseStaffAtRow(state.doc, line.number - 1);
	if (!parsed) return insertStaff(state, config);
	if (!parsed.ok) return { notice: parsed.problem };

	const mode: ActiveMode = {
		kind: 'tab',
		staffFrom: state.doc.line(parsed.staff.top + 1).from,
		pending: false,
		pickerOpen: false,
		chord: null,
	};
	const entered = state.update({ effects: setMode.of(mode), selection: EditorSelection.single(head) }).state;
	const info = currentStaff(entered);
	if (!info) return { notice: 'Put the cursor on a tab staff inside a code block first.' };
	return moveTo(state, mode, info.staff, info.row, info.pos);
}

export function insertStaff(state: EditorState, config: Config): ActionResult {
	const row = state.doc.lineAt(state.selection.main.head).number - 1;
	const here = parseStaffAtRow(state.doc, row);
	const labels = here?.ok ? staffLabelsLowToHigh(here.staff) : defaultTuning(config, config.instrument).strings;
	const plan = planInsertStaff(state.doc.toJSON(), row, labels, config.measures, config.beats);
	if (!plan.ok) return { notice: plan.problem };

	const changes = state.changes(toChanges(state, [plan.edit]));
	const doc = changes.apply(state.doc);
	const top = doc.line(plan.top + 1);
	return {
		spec: {
			changes,
			selection: EditorSelection.single(top.from + top.text.indexOf('|') + 1),
			scrollIntoView: true,
			annotations: isolateHistory.of('full'),
			effects: setMode.of({ kind: 'tab', staffFrom: top.from, pending: false, pickerOpen: false, chord: null }),
		},
	};
}

export function applyTuning(state: EditorState, tuning: Tuning): ActionResult {
	const mode = state.field(modeField);
	const info = currentStaff(state);
	if (mode.kind === 'off' || !info) return {};
	const edits = relabel(info.staff, tuning.strings);
	return editSpec(state, mode, info.staff, edits, info.row, info.pos, false);
}

/** A staff counts as bass if it matches a bass tuning, or matches no tuning and has a bass string count. */
function instrumentOf(staff: Staff, config: Config): Instrument {
	if (matchTuning(staff, config.bassTunings)) return 'bass';
	if (matchTuning(staff, config.tunings)) return 'guitar';
	return config.bassTunings.some(({ strings }) => strings.length === staff.rows.length) ? 'bass' : 'guitar';
}

function swapInstrument(state: EditorState, mode: ActiveMode, info: { staff: Staff; row: number; pos: Pos }, config: Config): ActionResult {
	const target = defaultTuning(config, instrumentOf(info.staff, config) === 'bass' ? 'guitar' : 'bass');
	const result = restring(info.staff, target.strings);
	if (!result.ok) return { notice: result.problem };
	// Stay on the same string counted from the low end, or the nearest one that still exists.
	const count = target.strings.length;
	const row = Math.max(0, Math.min(count - 1, info.row + count - info.staff.rows.length));
	return editSpec(state, { ...mode, kind: 'tab', chord: null }, info.staff, [result.edit], row, info.pos, false);
}

export function applyBeats(state: EditorState, beats: number): ActionResult {
	const mode = state.field(modeField);
	const info = currentStaff(state);
	if (mode.kind === 'off' || !info) return {};
	const edits = setMeasureBeats(info.staff, info.pos.measure, beats);
	return editSpec(state, mode, info.staff, edits, info.row, info.pos, false);
}

export function applyAction(state: EditorState, action: Action, config: Config): ActionResult {
	if (action.type === 'newStaff') return insertStaff(state, config);

	const mode = state.field(modeField);
	const info = currentStaff(state);
	if (mode.kind === 'off' || !info) return {};
	const { staff, row, pos } = info;
	const lines = (): string[] => state.doc.toJSON();

	switch (action.type) {
		case 'left':
			return moveTo(state, mode, staff, row, posLeft(staff, pos));
		case 'right':
			return moveTo(state, mode, staff, row, posRight(staff, pos));
		case 'prevMeasure':
			return moveTo(state, mode, staff, row, pos.measure > 0 ? { measure: pos.measure - 1, beat: 0 } : pos);
		case 'nextMeasure':
			return moveTo(
				state,
				mode,
				staff,
				row,
				pos.measure + 1 < staff.measures.length ? { measure: pos.measure + 1, beat: 0 } : pos,
			);
		case 'nextString': {
			if (row + 1 < staff.rows.length) return moveTo(state, mode, staff, row + 1, pos);
			const next = nextStaff(lines(), staff.top);
			return next ? switchStaff(state, mode, next, 0, pos, config) : moveTo(state, mode, staff, row, pos);
		}
		case 'prevString': {
			if (row > 0) return moveTo(state, mode, staff, row - 1, pos);
			const prev = prevStaff(lines(), staff.top);
			return prev
				? switchStaff(state, mode, prev, prev.height - 1, pos, config)
				: moveTo(state, mode, staff, row, pos);
		}
		case 'digit': {
			const { edit, pending } = writeFret(staff, row, pos, action.digit, mode.pending);
			return editSpec(state, mode, staff, [edit], row, pos, pending);
		}
		case 'clear':
			return editSpec(state, mode, staff, [clearCell(staff, row, pos)], row, pos, false);
		case 'clearLeft': {
			// The cursor is drawn at the start of its cell, so like a text editor, Backspace clears the cell before it.
			const left = posLeft(staff, pos);
			if (left === pos) return moveTo(state, mode, staff, row, pos);
			return editSpec(state, mode, staff, [clearCell(staff, row, left)], row, left, false);
		}
		case 'pickTuning': {
			const tunings = allTunings(config);
			const options = tunings.filter(({ strings }) => strings.length === staff.rows.length);
			if (options.length === 0) return { notice: `No configured tuning has ${staff.rows.length} strings.` };
			return { request: { kind: 'tuning', options, current: matchTuning(staff, tunings)?.name ?? null } };
		}
		case 'toggleKeys':
			return { spec: { effects: toggleKeys.of(null) } };
		case 'swapInstrument': {
			return swapInstrument(state, mode, info, config);
		}
		case 'pickBeats':
			return {
				request: { kind: 'beats', measure: pos.measure, current: (staff.measures[pos.measure] as Measure).beats },
			};
		case 'pickShape': {
			const names = Object.keys(availableShapes(staff, config)).sort();
			if (names.length === 0) return { notice: 'No chord shapes fit this staff.' };
			return { request: { kind: 'shape', names } };
		}
		case 'nextShape':
		case 'prevShape': {
			if (!mode.chord) return {};
			const count = mode.chord.names.length;
			const step = action.type === 'nextShape' ? 1 : count - 1;
			return setChord(mode, { ...mode.chord, index: (mode.chord.index + step) % count });
		}
		case 'rootUp':
			return mode.chord ? setChord(mode, { ...mode.chord, root: mode.chord.root + 1 }) : {};
		case 'rootDown':
			return mode.chord ? setChord(mode, { ...mode.chord, root: mode.chord.root - 1 }) : {};
		case 'writeChord': {
			if (!mode.chord) return {};
			const shape = mode.chord.shapes[mode.chord.names[mode.chord.index] as string] as Shape;
			const edits = writeVoicing(staff, pos, applyRoot(shape, mode.chord.root));
			return editSpec(state, mode, staff, edits, row, pos, false);
		}
		case 'exit':
			return {
				spec: { effects: setMode.of(mode.kind === 'chord' ? { ...mode, kind: 'tab', chord: null } : OFF) },
			};
	}
}
