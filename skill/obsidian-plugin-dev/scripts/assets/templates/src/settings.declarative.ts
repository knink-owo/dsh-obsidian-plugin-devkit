import { App, PluginSettingTab } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
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
 * Declarative settings (Obsidian 1.13.0+).
 *
 * Obsidian renders the tab from `getSettingDefinitions()`, binds every control
 * to `this.plugin.settings[key]`, persists changes itself, and runs `validate`
 * before accepting a value. No `display()` method is needed.
 */
export class {{PLUGIN_CLASS}}SettingTab extends PluginSettingTab {
	plugin: {{PLUGIN_CLASS}};

	constructor(app: App, plugin: {{PLUGIN_CLASS}}) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Sample text',
				desc: 'Demonstrates a declarative text control.',
				control: {
					type: 'text',
					key: 'sampleText',
					placeholder: DEFAULT_SETTINGS.sampleText,
					validate: (value) => (value.trim().length === 0 ? 'Must not be empty.' : undefined),
				},
			},
			{
				name: 'Sample toggle',
				desc: 'Demonstrates a declarative toggle control.',
				control: {
					type: 'toggle',
					key: 'sampleToggle',
				},
			},
			{
				name: 'Timestamp format',
				desc: 'Used by the "Insert timestamp" command.',
				control: {
					type: 'dropdown',
					key: 'format',
					options: { iso: 'ISO 8601', locale: 'Local time' },
				},
			},
		];
	}
}
