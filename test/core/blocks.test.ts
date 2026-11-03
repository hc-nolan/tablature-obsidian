import { describe, expect, it } from 'vitest';
import { findBlocks, findStaves, nextStaff, planInsertStaff, prevStaff, staffAt } from '../../src/core/blocks';

const staff = ['e|---|', 'B|---|'];

function applyPlan(lines: string[], row: number): { lines: string[]; top: number } {
	const plan = planInsertStaff(lines, row, ['E', 'e'], 1, 1);
	if (!plan.ok) throw new Error(plan.problem);
	const text = lines[plan.edit.row] as string;
	const replaced = text.slice(0, plan.edit.from) + plan.edit.insert + text.slice(plan.edit.to);
	return { lines: [...lines.slice(0, plan.edit.row), ...replaced.split('\n'), ...lines.slice(plan.edit.row + 1)], top: plan.top };
}

describe('findBlocks', () => {
	it('records open and close rows and eligibility', () => {
		expect(findBlocks(['x', '```tab', 'a', '```', '```js', 'b', '```'])).toEqual([
			{ open: 1, close: 3, eligible: true },
			{ open: 4, close: 6, eligible: false },
		]);
	});

	it('runs an unclosed fence to the end', () => {
		expect(findBlocks(['```', 'a'])).toEqual([{ open: 0, close: 2, eligible: true }]);
	});

	it('does not close a backtick fence with tildes', () => {
		expect(findBlocks(['```', '~~~', '```'])).toEqual([{ open: 0, close: 2, eligible: true }]);
	});

	it('does not treat a closing fence followed by text as closing', () => {
		expect(findBlocks(['```', '``` x', '```'])).toEqual([{ open: 0, close: 2, eligible: true }]);
	});

	it('allows up to 3 spaces of indent', () => {
		expect(findBlocks(['   ```', 'a', '   ```'])).toEqual([{ open: 0, close: 2, eligible: true }]);
	});

	it('does not open a fence on a backtick line whose info contains a backtick', () => {
		expect(findBlocks(['``` a`b', 'x'])).toEqual([]);
	});
});

describe('findStaves', () => {
	it.each<[string, string[], { top: number; height: number }[]]>([
		['tab block', ['```tab', ...staff, '```'], [{ top: 1, height: 2 }]],
		['bare block', ['```', ...staff, '```'], [{ top: 1, height: 2 }]],
		['case-insensitive info with extra words', ['```TAB extra', ...staff, '```'], [{ top: 1, height: 2 }]],
		['shorter fence does not close', ['~~~~', ...staff, '~~~', '~~~~'], [{ top: 1, height: 2 }]],
		['other language', ['```python', ...staff, '```'], []],
		['outside a fence', staff, []],
		['single row', ['```', 'e|---|', '```'], []],
		['unclosed', ['```tab', ...staff], [{ top: 1, height: 2 }]],
		['4-space indent is not a fence', ['    ```', ...staff, '    ```'], []],
		[
			'two staves split by annotation',
			['```tab', ...staff, 'note', ...staff, '```'],
			[
				{ top: 1, height: 2 },
				{ top: 4, height: 2 },
			],
		],
	])('%s', (_name, lines, expected) => {
		expect(findStaves(lines)).toEqual(expected);
	});
});

describe('staffAt', () => {
	const lines = ['```tab', 'note', ...staff, '', '```'];

	it('finds the staff from any of its rows', () => {
		expect(staffAt(lines, 2)).toEqual({ top: 2, height: 2 });
		expect(staffAt(lines, 3)).toEqual({ top: 2, height: 2 });
	});

	it('returns null off a staff', () => {
		expect(staffAt(lines, 1)).toBeNull();
		expect(staffAt(lines, 4)).toBeNull();
		expect(staffAt(lines, 0)).toBeNull();
	});
});

describe('nextStaff and prevStaff', () => {
	const lines = ['```tab', ...staff, '```', 'text', '```py', ...staff, '```', '```', ...staff, '```'];

	it('crosses blocks and skips non-eligible ones', () => {
		expect(nextStaff(lines, 1)).toEqual({ top: 10, height: 2 });
		expect(prevStaff(lines, 10)).toEqual({ top: 1, height: 2 });
	});

	it('returns null at the edges', () => {
		expect(prevStaff(lines, 1)).toBeNull();
		expect(nextStaff(lines, 10)).toBeNull();
	});
});

describe('planInsertStaff', () => {
	it('inserts below the whole staff with 2 blank lines, from any row', () => {
		for (const row of [1, 2]) {
			const result = applyPlan(['```tab', ...staff, '```'], row);
			expect(result.lines).toEqual(['```tab', ...staff, '', '', 'e|---|', 'E|---|', '```']);
			expect(result.top).toBe(5);
		}
	});

	it('inserts below the current line in a block off a staff', () => {
		const result = applyPlan(['```', 'note', '```'], 1);
		expect(result.lines).toEqual(['```', 'note', '', '', 'e|---|', 'E|---|', '```']);
		expect(result.top).toBe(4);
	});

	it('creates a new tab block outside a fence', () => {
		const result = applyPlan(['text'], 0);
		expect(result.lines).toEqual(['text', '```tab', 'e|---|', 'E|---|', '```']);
		expect(result.top).toBe(2);
	});

	it('works in an empty note', () => {
		const result = applyPlan([''], 0);
		expect(findStaves(result.lines)).toEqual([{ top: result.top, height: 2 }]);
	});

	// Review Focus 4
	it('places a new block after a closed non-tab block without changing it', () => {
		const result = applyPlan(['```python', 'x', '```', 'after'], 1);
		expect(result.lines.slice(0, 3)).toEqual(['```python', 'x', '```']);
		expect(result.lines[result.lines.length - 1]).toBe('after');
		expect(findStaves(result.lines)).toEqual([{ top: result.top, height: 2 }]);
	});

	it('creates a new block when on a closing fence', () => {
		const result = applyPlan(['```tab', ...staff, '```'], 3);
		expect(result.lines.slice(0, 4)).toEqual(['```tab', ...staff, '```']);
		expect(findStaves(result.lines)).toHaveLength(2);
	});

	it('refuses inside an unclosed non-tab block', () => {
		const plan = planInsertStaff(['```python', 'x'], 1, ['E', 'e'], 1, 1);
		expect(plan.ok).toBe(false);
		expect(!plan.ok && plan.problem).toMatch(/close/i);
	});
});
