import { Modal, Notice, Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	{{PLUGIN_CLASS}}Settings,
	{{PLUGIN_CLASS}}SettingTab,
} from './settings';

/**
 * {{PLUGIN_NAME}}
 *
 * Entry point: registered commands, ribbon action and settings tab live here.
 * Keep the class name in `manifest.json` sync? No — only the manifest id matters;
 * rename this class freely.
 */
export default class {{PLUGIN_CLASS}} extends Plugin {
	settings!: {{PLUGIN_CLASS}}Settings;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Ribbon action in the left sidebar.
		this.addRibbonIcon('pencil', '{{PLUGIN_NAME}}', () => {
			new Notice('{{PLUGIN_NAME}} is running.');
		});

		// Command palette entry.
		this.addCommand({
			id: 'open-modal',
			name: 'Open modal',
			callback: () => {
				new {{PLUGIN_CLASS}}Modal(this.app).open();
			},
		});

		// Editor command: runs only while a markdown editor is active.
		this.addCommand({
			id: 'insert-timestamp',
			name: 'Insert timestamp',
			editorCallback: (editor) => {
				const stamp =
					this.settings.format === 'locale'
						? new Date().toLocaleString()
						: new Date().toISOString();
				editor.replaceSelection(stamp);
			},
		});

		// Settings tab (declarative on Obsidian 1.13.0+, display() otherwise).
		this.addSettingTab(new {{PLUGIN_CLASS}}SettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class {{PLUGIN_CLASS}}Modal extends Modal {
	onOpen(): void {
		this.contentEl.createEl('h2', { text: '{{PLUGIN_NAME}}' });
		this.contentEl.createEl('p', {
			text: 'Replace this modal with your plugin UI.',
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
