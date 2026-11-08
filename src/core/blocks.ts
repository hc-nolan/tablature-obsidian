// Finds fenced code blocks and the staves inside them. Pure: no editor or Obsidian dependencies.

import { generateStaff, isStaffLine, type LineEdit } from './staff';

export interface Block {
	open: number;
	/** Row of the closing fence, or the line count if the block is unclosed. */
	close: number;
	eligible: boolean;
}

export interface StaffRange {
	top: number;
	height: number;
}

export type InsertPlan = { ok: true; edit: LineEdit; top: number } | { ok: false; problem: string };

const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const MIN_STAFF_ROWS = 2;

function closesFence(line: string, fence: string): boolean {
	const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
	return !!match && match[1]?.[0] === fence[0] && (match[1]?.length ?? 0) >= fence.length;
}

function isEligibleInfo(info: string): boolean {
	const word = info.trim().split(/\s+/)[0] ?? '';
	return word === '' || word.toLowerCase() === 'tab';
}

export function findBlocks(lines: string[]): Block[] {
	const blocks: Block[] = [];
	for (let row = 0; row < lines.length; row++) {
		const match = OPENING_FENCE.exec(lines[row] as string);
		if (!match) continue;
		const fence = match[1] as string;
		const info = match[2] as string;
		if (fence[0] === '`' && info.includes('`')) continue;

		let close = row + 1;
		while (close < lines.length && !closesFence(lines[close] as string, fence)) close++;
		blocks.push({ open: row, close, eligible: isEligibleInfo(info) });
		row = close;
	}
	return blocks;
}

export function findStaves(lines: string[]): StaffRange[] {
	const staves: StaffRange[] = [];
	for (const block of findBlocks(lines)) {
		if (!block.eligible) continue;
		let row = block.open + 1;
		while (row < block.close) {
			if (!isStaffLine(lines[row] as string)) {
				row++;
				continue;
			}
			const top = row;
			while (row < block.close && isStaffLine(lines[row] as string)) row++;
			if (row - top >= MIN_STAFF_ROWS) staves.push({ top, height: row - top });
		}
	}
	return staves;
}

export function staffAt(lines: string[], row: number): StaffRange | null {
	return findStaves(lines).find(({ top, height }) => row >= top && row < top + height) ?? null;
}

export function nextStaff(lines: string[], top: number): StaffRange | null {
	return findStaves(lines).find((staff) => staff.top > top) ?? null;
}

export function prevStaff(lines: string[], top: number): StaffRange | null {
	const above = findStaves(lines).filter((staff) => staff.top < top);
	return above[above.length - 1] ?? null;
}

export function planInsertStaff(
	lines: string[],
	row: number,
	labelsLowToHigh: string[],
	measures: number,
	beats: number,
): InsertPlan {
	const staffLines = generateStaff(labelsLowToHigh, measures, beats).join('\n');
	const appendAfter = (afterRow: number, insert: string, top: number): InsertPlan => {
		const end = (lines[afterRow] as string).length;
		return { ok: true, edit: { row: afterRow, from: end, to: end, insert }, top };
	};

	// `row < close` deliberately excludes the closing fence: a cursor there is outside the block.
	const block = findBlocks(lines).find(({ open, close }) => row >= open && row < close);

	if (block?.eligible) {
		const current = staffAt(lines, row);
		const afterRow = current ? current.top + current.height - 1 : row;
		// Without a gap, a staff on the next line would merge with the new one.
		const gap = isStaffLine(lines[afterRow + 1] ?? '') ? '\n\n' : '';
		// A cursor on the opening fence is the top of the block, so the staff starts right below the fence.
		if (!current && row === block.open) return appendAfter(afterRow, `\n${staffLines}${gap}`, afterRow + 1);
		return appendAfter(afterRow, `\n\n\n${staffLines}${gap}`, afterRow + 3);
	}

	const newBlock = `\n\`\`\`tab\n${staffLines}\n\`\`\``;
	if (!block) return appendAfter(row, newBlock, row + 2);

	if (block.close >= lines.length) {
		return { ok: false, problem: 'This code block has no closing fence. Close the code block first, then insert a staff.' };
	}
	return appendAfter(block.close, newBlock, block.close + 2);
}
