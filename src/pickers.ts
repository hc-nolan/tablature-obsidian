// Obsidian dialogs for choosing a tuning, a chord shape or a beat count. Each resolves null when cancelled.

import { type App, Modal, Setting, SuggestModal } from 'obsidian';
import type { Tuning } from './core/config';
import { parseBeatCount } from './core/staff';

class ChoiceModal<T> extends SuggestModal<T> {
	constructor(
		app: App,
		private readonly items: T[],
		private readonly label: (item: T) => string,
		private readonly resolve: (item: T | null) => void,
	) {
		super(app);
	}

	getSuggestions(query: string): T[] {
		const needle = query.toLowerCase();
		return this.items.filter((item) => this.label(item).toLowerCase().includes(needle));
	}

	renderSuggestion(item: T, el: HTMLElement): void {
		el.setText(this.label(item));
	}

	onChooseSuggestion(item: T): void {
		this.resolve(item);
	}

	onClose(): void {
		super.onClose();
		// Obsidian closes the modal before calling onChooseSuggestion, so give a choice the chance to resolve first.
		window.setTimeout(() => this.resolve(null), 0);
	}
}

class BeatsModal extends Modal {
	constructor(
		app: App,
		private readonly measure: number,
		private readonly current: number,
		private readonly resolve: (beats: number | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(`Beats in measure ${this.measure + 1}`);
		let value = String(this.current);
		const submit = (): void => {
			const beats = parseBeatCount(value);
			if (beats === null) {
				error.setText('Enter a whole number from 1 to 128.');
				return;
			}
			this.resolve(beats);
			this.close();
		};
		const setting = new Setting(this.contentEl).setName('Beats').addText((text) => {
			text.setValue(value).onChange((next) => {
				value = next;
				error.setText('');
			});
			text.inputEl.addEventListener('keydown', (event) => {
				if (event.key !== 'Enter') return;
				event.preventDefault();
				submit();
			});
			window.setTimeout(() => text.inputEl.select(), 0);
		});
		const error = this.contentEl.createDiv({ cls: 'tablature-setting-error' });
		setting.addButton((button) => button.setButtonText('Apply').setCta().onClick(submit));
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(null);
	}
}

export function pickTuning(app: App, options: Tuning[], current: string | null): Promise<Tuning | null> {
	const label = ({ name }: Tuning): string => (name === current ? `${name} (active)` : name);
	return new Promise((resolve) => new ChoiceModal(app, options, label, resolve).open());
}

export function pickShape(app: App, names: string[]): Promise<string | null> {
	return new Promise((resolve) => new ChoiceModal(app, names, (name) => name, resolve).open());
}

export function promptBeats(app: App, measure: number, current: number): Promise<number | null> {
	return new Promise((resolve) => new BeatsModal(app, measure, current, resolve).open());
}
