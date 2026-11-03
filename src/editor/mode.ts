// Per-editor tab and chord mode state.

import { type ChangeSpec, EditorSelection, EditorState, type Extension, StateEffect, StateField, type Text } from '@codemirror/state';
import { staffAt } from '../core/blocks';
import type { Shape } from '../core/config';
import { colToPos, type LineEdit, parseStaff, type ParseResult, posToCol, type Pos, type Staff } from '../core/staff';

export type ChordState = { names: string[]; shapes: Record<string, Shape>; index: number; root: number };

export type ActiveMode = {
	kind: 'tab' | 'chord';
	/** Offset of the start of the staff's top row. */
	staffFrom: number;
	pending: boolean;
	pickerOpen: boolean;
	chord: ChordState | null;
};

export type ModeState = { kind: 'off'; notice: string | null } | ActiveMode;

export const OFF: ModeState = { kind: 'off', notice: null };

/** The value is expressed in the coordinates of the document after the transaction. */
export const setMode = StateEffect.define<ModeState>();

const STAFF_GONE = 'The staff you were editing is gone, so tab mode has exited.';

type Located = { ok: true; result: ParseResult & { ok: true } } | { ok: false; notice: string };

export function parseStaffAtRow(doc: Text, row: number): ParseResult | null {
	const lines = doc.toJSON();
	const range = staffAt(lines, row);
	return range ? parseStaff(lines.slice(range.top, range.top + range.height), range.top) : null;
}

function locate(doc: Text, offset: number): Located {
	const result = parseStaffAtRow(doc, doc.lineAt(offset).number - 1);
	if (!result) return { ok: false, notice: STAFF_GONE };
	if (!result.ok) return { ok: false, notice: result.problem };
	return { ok: true, result };
}

export const modeField = StateField.define<ModeState>({
	create: () => OFF,
	update(value, tr) {
		let next = value;
		if (next.kind !== 'off' && tr.docChanged) {
			const mapped = tr.newDoc.lineAt(tr.changes.mapPos(next.staffFrom, 1)).from;
			const found = locate(tr.newDoc, mapped);
			next = found.ok
				? { ...next, staffFrom: tr.newDoc.line(found.result.staff.top + 1).from }
				: { kind: 'off', notice: found.notice };
		}
		for (const effect of tr.effects) {
			if (effect.is(setMode)) next = effect.value;
		}
		return next;
	},
});

export function currentStaff(state: EditorState): { staff: Staff; row: number; pos: Pos } | null {
	const mode = state.field(modeField);
	if (mode.kind === 'off') return null;
	const found = locate(state.doc, mode.staffFrom);
	if (!found.ok) return null;
	const { staff } = found.result;
	const line = state.doc.lineAt(state.selection.main.head);
	const row = Math.max(0, Math.min(staff.rows.length - 1, line.number - 1 - staff.top));
	return { staff, row, pos: colToPos(staff, state.selection.main.head - line.from) };
}

export function toChanges(state: EditorState, edits: LineEdit[]): ChangeSpec[] {
	return edits.map(({ row, from, to, insert }) => {
		const lineFrom = state.doc.line(row + 1).from;
		return { from: lineFrom + from, to: lineFrom + to, insert };
	});
}

/**
 * Keeps the cursor on a valid cell when the user moves it directly: a click snaps to a cell or switches staff,
 * and a click elsewhere exits. Undo and redo restore a selection, so they are snapped too; if they remove the
 * staff, `modeField` handles the exit.
 */
export const selectionFilter: Extension = EditorState.transactionFilter.of((tr) => {
	const mode = tr.startState.field(modeField);
	if (mode.kind === 'off') return tr;
	const isSelect = tr.isUserEvent('select');
	const isHistory = tr.isUserEvent('undo') || tr.isUserEvent('redo');
	if (!isSelect && !isHistory) return tr;

	const head = tr.newSelection.main.head;
	const line = tr.newDoc.lineAt(head);
	const result = parseStaffAtRow(tr.newDoc, line.number - 1);

	if (!result || !result.ok) {
		if (isHistory) return tr;
		return [tr, { effects: setMode.of({ kind: 'off', notice: result ? result.problem : null }), sequential: true }];
	}

	const { staff } = result;
	const staffFrom = tr.newDoc.line(staff.top + 1).from;
	const anchor = line.from + posToCol(staff, colToPos(staff, head - line.from));
	const switched = chordAfterSwitch(mode, staff);
	return [
		tr,
		{
			selection: EditorSelection.single(anchor),
			effects: setMode.of({ ...switched, staffFrom, pending: false }),
			sequential: true,
		},
	];
});

/** A click can't re-resolve shapes, so a chord session survives only on a staff its shapes fit. */
function chordAfterSwitch(mode: ActiveMode, staff: Staff): ActiveMode {
	if (!mode.chord) return mode;
	const name = mode.chord.names[mode.chord.index] as string;
	const fits = mode.chord.shapes[name]?.length === staff.rows.length;
	return fits ? mode : { ...mode, kind: 'tab', chord: null };
}
