// Turns mode actions into transactions. No DOM or Obsidian access, so all of this runs against a plain EditorState.

import { isolateHistory } from '@codemirror/commands';
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { nextStaff, planInsertStaff, prevStaff, type StaffRange } from '../core/blocks';
import { matchTuning } from '../core/chords';
import type { Config, Tuning } from '../core/config';
import {
	clampPos,
	clearCell,
	type LineEdit,
	type Measure,
	parseStaff,
	posToCol,
	type Pos,
	relabel,
	setMeasureBeats,
	type Staff,
	staffLabelsLowToHigh,
	writeFret,
} from '../core/staff';
import { type ActiveMode, currentStaff, modeField, OFF, parseStaffAtRow, setMode, toChanges } from './mode';

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

function switchStaff(
	state: EditorState,
	mode: ActiveMode,
	range: StaffRange,
	stringRow: number,
	pos: Pos,
): ActionResult {
	const parsed = parseStaff(state.doc.toJSON().slice(range.top, range.top + range.height), range.top);
	if (!parsed.ok) return { notice: parsed.problem };
	const staffFrom = state.doc.line(range.top + 1).from;
	return moveTo(state, { ...mode, staffFrom }, parsed.staff, stringRow, clampPos(parsed.staff, pos));
}

export function enterAt(state: EditorState, _config: Config): ActionResult {
	const head = state.selection.main.head;
	const line = state.doc.lineAt(head);
	const parsed = parseStaffAtRow(state.doc, line.number - 1);
	if (!parsed) return { notice: 'Put the cursor on a tab staff inside a code block first.' };
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
	const labels = here?.ok ? staffLabelsLowToHigh(here.staff) : (config.tunings[0] as Tuning).strings;
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
			return next ? switchStaff(state, mode, next, 0, pos) : moveTo(state, mode, staff, row, pos);
		}
		case 'prevString': {
			if (row > 0) return moveTo(state, mode, staff, row - 1, pos);
			const prev = prevStaff(lines(), staff.top);
			return prev ? switchStaff(state, mode, prev, prev.height - 1, pos) : moveTo(state, mode, staff, row, pos);
		}
		case 'digit': {
			const { edit, pending } = writeFret(staff, row, pos, action.digit, mode.pending);
			return editSpec(state, mode, staff, [edit], row, pos, pending);
		}
		case 'clear':
			return editSpec(state, mode, staff, [clearCell(staff, row, pos)], row, pos, false);
		case 'clearLeft':
			return editSpec(state, mode, staff, [clearCell(staff, row, pos)], row, posLeft(staff, pos), false);
		case 'pickTuning': {
			const options = config.tunings.filter(({ strings }) => strings.length === staff.rows.length);
			if (options.length === 0) return { notice: `No configured tuning has ${staff.rows.length} strings.` };
			return { request: { kind: 'tuning', options, current: matchTuning(staff, config.tunings)?.name ?? null } };
		}
		case 'pickBeats':
			return {
				request: { kind: 'beats', measure: pos.measure, current: (staff.measures[pos.measure] as Measure).beats },
			};
		case 'exit':
			return { spec: { effects: setMode.of(OFF) } };
		default:
			return {};
	}
}
