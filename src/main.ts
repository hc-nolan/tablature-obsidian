// Registers the editor extensions, commands and settings tab.

import type { EditorView } from '@codemirror/view';
import { type Editor, MarkdownView, Notice, Platform, Plugin } from 'obsidian';
import { type Config, mergeConfig } from './core/config';
import { enterAt } from './editor/actions';
import { decorationsExtension } from './editor/decorations';
import { type EditorDeps, keyPlugin, runAction } from './editor/keys';
import { modeField, OFF, selectionFilter, setMode } from './editor/mode';
import { pickShape, pickTuning, promptBeats } from './pickers';
import { TablatureSettingTab } from './settings';

/** Obsidian's documented route to the CodeMirror view behind an editor. */
function editorView(editor: Editor): EditorView {
	return (editor as unknown as { cm: EditorView }).cm;
}

export default class TablaturePlugin extends Plugin {
	config: Config = mergeConfig(null);

	async onload(): Promise<void> {
		this.config = mergeConfig(await this.loadData());

		const deps: EditorDeps = {
			getConfig: () => this.config,
			pickTuning: (options, current) => pickTuning(this.app, options, current),
			pickShape: (names) => pickShape(this.app, names),
			promptBeats: (measure, current) => promptBeats(this.app, measure, current),
			notify: (message) => new Notice(message),
			isMac: Platform.isMacOS,
		};

		this.registerEditorExtension([
			modeField,
			selectionFilter,
			keyPlugin(deps),
			decorationsExtension(() => this.config),
		]);

		this.addCommand({
			id: 'insert-staff',
			name: 'Insert staff',
			editorCheckCallback: (checking, editor, ctx) => {
				if (ctx instanceof MarkdownView && ctx.getMode() === 'preview') return false;
				if (!checking) runAction(editorView(editor), { type: 'newStaff' }, deps);
				return true;
			},
		});

		this.addCommand({
			id: 'enter-tab-mode',
			name: 'Enter tab mode',
			editorCheckCallback: (checking, editor, ctx) => {
				if (ctx instanceof MarkdownView && ctx.getMode() === 'preview') return false;
				if (!checking) {
					const view = editorView(editor);
					const result = enterAt(view.state, this.config);
					if (result.spec) view.dispatch(result.spec);
					if (result.notice) deps.notify(result.notice);
				}
				return true;
			},
		});

		this.addSettingTab(new TablatureSettingTab(this.app, this));

		// A note opened in the same pane reuses the active view, so this one includes it.
		this.registerEvent(this.app.workspace.on('file-open', () => this.exitWhere(() => true)));
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				const active = this.app.workspace.getActiveViewOfType(MarkdownView);
				this.exitWhere((view) => view !== active);
			}),
		);
		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.exitWhere((view) => view.getMode() === 'preview')),
		);
	}

	async saveConfig(): Promise<void> {
		await this.saveData(this.config);
	}

	/** Silently leaves tab mode in every open note that matches. */
	private exitWhere(matches: (view: MarkdownView) => boolean): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!(leaf.view instanceof MarkdownView) || !matches(leaf.view)) return;
			const cm = editorView(leaf.view.editor);
			const mode = cm.state.field(modeField, false);
			if (mode && mode.kind !== 'off') cm.dispatch({ effects: setMode.of(OFF) });
		});
	}
}
