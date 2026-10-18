# Plugin lifecycle and API patterns

A plugin is one class extending `Plugin`, loaded from `main.js` (CommonJS).
The app instantiates it once, calls `onload()` on first enable and
`onunload()` on disable/quit. Everything registered in `onload()` is owned by
the plugin and must be released in `onunload()` or via the registration
helpers below.

## Minimal skeleton

```ts
import { Plugin, Notice } from "obsidian";

export default class MyPlugin extends Plugin {
  async onload(): Promise<void> {
    await this.loadSettings();
    this.addRibbonIcon("dice", "My command", () => new Notice("Hello"));
    this.addCommand({ id: "open-modal", name: "Open modal", callback: () => this.open() });
    this.addSettingTab(new SettingsTab(this.app, this));
    this.registerEvent(this.app.workspace.on("file-open", (file) => { /* ... */ }));
  }

  onunload(): void { /* automatic for addCommand / registerEvent / addSettingTab */ }
}
```

## Registration helpers (prefer them over manual cleanup)

- `this.registerEvent(app.workspace.on(...))` — unregistered on unload.
- `this.registerDomEvent(el, "click", fn)` and `this.registerInterval(id)`.
- `this.addCommand({ id, name, callback })` — ids are namespaced by plugin id;
  use `checkCallback` when the command depends on the active view.
- `this.addRibbonIcon(icon, label, callback)`.
- `this.addSettingTab(tab)`.
- `this.registerView(type, factory)` + `this.app.workspace.getLeaf().setViewState(...)`.

## Vault writes

- Read: `app.vault.read(file)` (full text), `app.vault.cachedRead(file)` (fast,
  may be cached), `app.vault.readBinary(file)`.
- Write: `app.vault.process(file, (data) => changed)` for atomic edits;
  `app.vault.modify(file, text)` replaces the whole file (and loses editor
  state). Frontmatter: `app.fileManager.processFrontMatter(file, (fm) => ...)`.
- Create/delete: `app.vault.create(path, text)`, `app.vault.trash(file, true)`.
  Always `normalizePath()` user-supplied paths.
- Never write vault files with Node `fs`: Obsidian caches the vault and the
  change will not appear until a manual rescan.

## Events worth knowing

`app.workspace.on("file-open" | "active-leaf-change" | "layout-ready")`,
`app.vault.on("create" | "modify" | "delete" | "rename")`,
`app.metadataCache.on("changed")`. Long startup work belongs in
`app.workspace.onLayoutReady()` — `onload` runs before the workspace settles.

## UI building blocks

Modal (`onOpen`/`onClose` + `contentEl`), `Notice`, status bar item
(`addStatusBarItem`), context menus (`app.workspace.on("file-menu")`),
Markdown post processors (`registerMarkdownPostProcessor`), and deferred views
for panels (`DeferredView` on 1.7.2+; `instanceof` before activating).

Use the `obsidian` module only; `moment` is re-exported by `obsidian`. Do not
bundle your own copy of `obsidian`, `electron`, `@codemirror/*` or `@lezer/*`.
