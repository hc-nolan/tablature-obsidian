// The host-agnostic barrel: everything a non-Obsidian host imports, with no Obsidian globals.
import { describe, expect, it } from 'vitest';
import * as tablature from '../src/index';

describe('index', () => {
	it('exports the tab core', () => {
		const staff = tablature.parseStaff(['e|------------|', 'E|------------|'], 0);
		expect(staff.ok).toBe(true);
		expect(tablature.generateStaff(['E', 'A', 'D', 'G'], 1, 4).map((row) => row[0])).toEqual([
			'G',
			'D',
			'A',
			'E',
		]);
		expect(tablature.DEFAULT_CONFIG.instrument).toBe('guitar');
	});

	it('exports the CodeMirror extensions', () => {
		expect(tablature.modeField).toBeDefined();
		expect(tablature.keysExpandedField).toBeDefined();
		expect(tablature.selectionFilter).toBeDefined();
		expect(typeof tablature.decorationsExtension).toBe('function');
		expect(typeof tablature.keyPlugin).toBe('function');
		expect(typeof tablature.enterAt).toBe('function');
		expect(typeof tablature.runAction).toBe('function');
	});
});
