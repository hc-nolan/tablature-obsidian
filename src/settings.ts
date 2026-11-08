// The settings tab. Invalid input shows an inline error and is never saved, so the last valid value stays in use.

import { type App, type Plugin, PluginSettingTab, type Setting, type SettingDefinitionItem } from 'obsidian';
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

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			this.numberItem('Default beats per measure', 'Used for new staves.', 'beats'),
			this.numberItem('Default measures per staff', 'Used for new staves.', 'measures'),
			this.instrumentItem(),
			this.textItem(
				'Guitar tunings',
				'One per line, low to high: name | E A D G B e. The first is the default for new guitar staves.',
				() => formatTunings(this.host.config.tunings),
				parseTunings,
				(tunings) => (this.host.config.tunings = tunings),
				() => (this.host.config.tunings = DEFAULT_CONFIG.tunings),
			),
			this.textItem(
				'Bass tunings',
				'One per line, low to high: name | E A D G. The first is the default for new bass staves.',
				() => formatTunings(this.host.config.bassTunings),
				parseTunings,
				(tunings) => (this.host.config.bassTunings = tunings),
				() => (this.host.config.bassTunings = DEFAULT_CONFIG.bassTunings),
			),
			this.textItem(
				'Chord shapes',
				'One per line, low to high: default or tuning name | shape name | 0 2 2 x x x',
				() => formatChords(this.host.config.chords),
				parseChords,
				(chords) => (this.host.config.chords = chords),
				() => (this.host.config.chords = DEFAULT_CONFIG.chords),
			),
		];
	}

	private instrumentItem(): SettingDefinitionItem {
		const name = 'New staves use';
		const desc = 'The instrument for a staff inserted outside an existing one. Press I in tab mode to switch a staff.';
		return {
			name,
			desc,
			render: (setting) => {
				setting.setName(name).setDesc(desc);
				setting.addDropdown((dropdown) =>
					dropdown
						.addOptions({ guitar: 'Guitar', bass: 'Bass' })
						.setValue(this.host.config.instrument)
						.onChange(async (value) => {
							this.host.config.instrument = value === 'bass' ? 'bass' : 'guitar';
							await this.host.saveConfig();
						}),
				);
				this.addReset(setting, () => (this.host.config.instrument = DEFAULT_CONFIG.instrument));
			},
		};
	}

	private numberItem(name: string, desc: string, key: 'beats' | 'measures'): SettingDefinitionItem {
		return {
			name,
			desc,
			render: (setting) => {
				setting.setName(name).setDesc(desc);
				const error = setting.descEl.createDiv({ cls: 'tablature-setting-error' });
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
			},
		};
	}

	private textItem<T>(
		name: string,
		desc: string,
		current: () => string,
		parse: (text: string) => Parsed<T>,
		apply: (value: T) => void,
		reset: () => void,
	): SettingDefinitionItem {
		return {
			name,
			desc,
			render: (setting) => {
				setting.setName(name).setDesc(desc);
				setting.settingEl.addClass('tablature-text-setting');
				const error = setting.descEl.createDiv({ cls: 'tablature-setting-error' });
				setting.addTextArea((area) =>
					area.setValue(current()).onChange(async (value) => {
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
			},
		};
	}

	private addReset(setting: Setting, reset: () => void): void {
		setting.addExtraButton((button) =>
			button
				.setIcon('reset')
				.setTooltip('Reset to default')
				.onClick(async () => {
					reset();
					await this.host.saveConfig();
					this.update();
				}),
		);
	}
}
