# Settings: declarative (1.13+) vs legacy

Obsidian 1.13.0 added a declarative settings API. The choice is driven by
`minAppVersion`, not by preference.

## Declarative (minAppVersion >= 1.13.0)

Extend `PluginSettingTab` and override `getSettingDefinitions()`; return an
array of control definitions. Obsidian renders the tab, binds values to
`this.plugin.settings[key]`, saves after edits, and runs your per-control
`validate` function.

```ts
import { App, PluginSettingTab, type SettingDefinitionItem } from "obsidian";

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: MyPlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { name: "Enable feature", desc: "Turns the thing on.", control: { type: "toggle", key: "enabled" } },
      { name: "Mode", control: { type: "dropdown", key: "mode", options: { fast: "Fast", safe: "Safe" } } },
      { name: "Endpoint", control: { type: "text", key: "endpoint", placeholder: "https://..." } },
    ];
  }
}
```

Rules:

- Register the tab with `addSettingTab(new SettingsTab(this.app, this))` in
  `onload()` and delete the old `display()` method entirely — mixing both is
  rejected by review tooling and shows two tabs.
- Declare settings with defaults in `loadSettings()`; the control `key` is the
  settings property name.
- Use `Setting`-based imperative UI only through a custom control or the legacy
  path; declarative API is for the standard controls.
- `validate` may return a string (error) or `void`/`Promise<void>` (ok).

## Legacy (minAppVersion < 1.13.0)

Keep `display()` and build rows with `new Setting(containerEl)`. This is
required for `minAppVersion` below 1.13.0; the declarative method is ignored by
older apps, which then show an empty tab.

## Secrets

Do not store API keys in `data.json` in plain text when the device may be
shared. 1.11+ has `app.secretStorage` / `SecretComponent`; store the key in
secret storage and keep only a reference in settings.
