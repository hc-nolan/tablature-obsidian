// The settings tab. Invalid input shows an inline error and is never saved, so the last valid value stays in use.

import { type App, type Plugin, PluginSettingTab, Setting } from 'obsidian';
import {
	type Config,
	DEFAULT_CONFIG,
	formatChords,
	formatTunings,
	type Parsed,
	parseChords,
	parseTunings,
} from './core/config';
import { parseBeatCount } from './core/staff';

export interface SettingsHost extends Plugin {
	config: Config;
	saveConfig(): Promise<void>;
}

export class TablatureSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly host: SettingsHost,
	) {
		super(app, host);
	}

	display(): void {
		this.containerEl.empty();
		this.addNumber('Default beats per measure', 'Used for new staves.', 'beats');
		this.addNumber('Default measures per staff', 'Used for new staves.', 'measures');
		this.addText(
			'Tunings',
			'One per line, low to high: name | E A D G B e. The first is the default for new staves.',
			formatTunings(this.host.config.tunings),
			parseTunings,
			(tunings) => (this.host.config.tunings = tunings),
			() => (this.host.config.tunings = DEFAULT_CONFIG.tunings),
		);
		this.addText(
			'Chord shapes',
			'One per line, low to high: default or tuning name | shape name | 0 2 2 x x x',
			formatChords(this.host.config.chords),
			parseChords,
			(chords) => (this.host.config.chords = chords),
			() => (this.host.config.chords = DEFAULT_CONFIG.chords),
		);
	}

	private addNumber(name: string, desc: string, key: 'beats' | 'measures'): void {
		const setting = new Setting(this.containerEl).setName(name).setDesc(desc);
		const error = this.containerEl.createDiv({ cls: 'tablature-setting-error' });
		setting.addText((text) =>
			text.setValue(String(this.host.config[key])).onChange(async (value) => {
				const parsed = parseBeatCount(value);
				error.setText(parsed === null ? 'Enter a whole number from 1 to 128.' : '');
				if (parsed === null) return;
				this.host.config[key] = parsed;
				await this.host.saveConfig();
			}),
		);
		this.addReset(setting, () => (this.host.config[key] = DEFAULT_CONFIG[key]));
	}

	private addText<T>(
		name: string,
		desc: string,
		initial: string,
		parse: (text: string) => Parsed<T>,
		apply: (value: T) => void,
		reset: () => void,
	): void {
		const setting = new Setting(this.containerEl).setName(name).setDesc(desc);
		setting.settingEl.addClass('tablature-text-setting');
		const error = this.containerEl.createDiv({ cls: 'tablature-setting-error' });
		setting.addTextArea((area) =>
			area.setValue(initial).onChange(async (value) => {
				const parsed = parse(value);
				if (!parsed.ok) {
					error.setText(`Line ${parsed.line}: ${parsed.problem}`);
					return;
				}
				error.setText('');
				apply(parsed.value);
				await this.host.saveConfig();
			}),
		);
		this.addReset(setting, reset);
	}

	private addReset(setting: Setting, reset: () => void): void {
		setting.addExtraButton((button) =>
			button
				.setIcon('reset')
				.setTooltip('Reset to default')
				.onClick(async () => {
					reset();
					await this.host.saveConfig();
					this.display();
				}),
		);
	}
}
