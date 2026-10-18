import { App, PluginSettingTab, Setting } from 'obsidian';
import type {{PLUGIN_CLASS}} from './main';

export interface {{PLUGIN_CLASS}}Settings {
	sampleText: string;
	sampleToggle: boolean;
	format: 'iso' | 'locale';
}

export const DEFAULT_SETTINGS: {{PLUGIN_CLASS}}Settings = {
	sampleText: 'Hello from {{PLUGIN_NAME}}',
	sampleToggle: true,
	format: 'iso',
};

/**
 * Legacy settings tab using the `display()` + `new Setting(...)` API.
 *
 * Needed when `manifest.json.minAppVersion` is below 1.13.0 (the declarative
 * `getSettingDefinitions()` API is only available from Obsidian 1.13.0).
 */
export class {{PLUGIN_CLASS}}SettingTab extends PluginSettingTab {
	plugin: {{PLUGIN_CLASS}};

	constructor(app: App, plugin: {{PLUGIN_CLASS}}) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Sample text')
			.setDesc('Demonstrates an imperative text control.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.sampleText)
					.setValue(this.plugin.settings.sampleText)
					.onChange(async (value) => {
						this.plugin.settings.sampleText = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Sample toggle')
			.setDesc('Demonstrates an imperative toggle control.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.sampleToggle)
					.onChange(async (value) => {
						this.plugin.settings.sampleToggle = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Timestamp format')
			.setDesc('Used by the "Insert timestamp" command.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('iso', 'ISO 8601')
					.addOption('locale', 'Local time')
					.setValue(this.plugin.settings.format)
					.onChange(async (value) => {
						this.plugin.settings.format = value === 'locale' ? 'locale' : 'iso';
						await this.plugin.saveSettings();
					}),
			);
	}
}
