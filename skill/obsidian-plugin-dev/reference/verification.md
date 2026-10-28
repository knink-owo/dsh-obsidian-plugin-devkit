# Layered verification

One green build proves almost nothing. Check each layer, and never promote a
claim to the next layer without evidence at the current one.

## L1 — static (`node scripts/devkit.mjs build`, `validate`)

- Build exits 0 and emits `main.js`.
- `main.js` is CommonJS: it has `module.exports` / `exports.` and a
  `require("obsidian")`-shaped external reference, not top-level `import`.
- `manifest.json`, `package.json` and `versions.json` agree; the manifest id is
  submission-safe; the settings style matches `minAppVersion`.
- `validate` warnings are real findings, not trivia; fix or knowingly accept
  each one.

## L2 — isolated smoke (`node scripts/devkit.mjs test`)

`--scenario load` executes the bundle against a stubbed `obsidian` module;
`--scenario onload` / `unload` also instantiate the plugin and await
`onload`/`onunload` under a timeout. The default export must be a class
extending the stubbed `Plugin`. This catches import-time crashes, ESM output,
missing exports and wrong module format. It does not prove real-API
compatibility — the bundle runs against stubs, not Obsidian.

## L3 — real vault (`deploy`, `status`, `reload`, `e2e`)

- `deploy` writes `main.js`, `manifest.json`, `styles.css` into
  `<vault>/.obsidian/plugins/<id>/` and merges the id into
  `community-plugins.json` without replacing other entries.
- The app lists the plugin as *enabled* (read-only proof via the CLI), and the
  app's *active vault* is the target vault — commands act on the frontmost
  window, so a different foreground vault means "unknown", not "failed".
- Reload/rescan paths need Obsidian running with the CLI enabled
  (>= 1.12.4). If any of that is missing, report the limitation; never open the
  app yourself and never pretend it worked.
- `node scripts/devkit.mjs e2e <dir>` (action `init`) writes a reviewable
  `wdio-obsidian-service` harness into the project: `wdio.conf.mts`, a
  generated spec, a fixture vault, `e2e/tsconfig.json`, merged devDependencies
  and a `test:e2e` script. Action `status` audits it read-only. The command never
  runs the suite (first run downloads Obsidian and opens a window): hand the
  command to a human or CI, and remember the harness uses an isolated config
  dir and a throwaway vault copy, not the developer's vaults.

## L3.5 — scripted UI probing (DevTools / CDP)

When a human cannot click through every flow, drive the running app over the
Chrome DevTools Protocol. This is still *scripted observation*, not proof of a
good UX: keep the screenshot and the raw values.

- Start the app with `--remote-debugging-port=9222` (and, if needed, a separate
  `--user-data-dir`); ask before restarting a user's app, and never kill it
  mid-save. `http://127.0.0.1:9222/json` lists the targets; `Runtime.evaluate`
  has access to the `app` global.
- Drive with a small scenario runner: ordered `eval` / `wait` / `click` /
  `drag` / `key` / `screenshot` steps, coordinates resolved from fresh
  `getBoundingClientRect()` results on every action.
- **The page is hidden unless you say otherwise.** `document.hidden` is often
  `true` for a CDP target, which pauses `requestAnimationFrame` and throttles
  timers; waits then look like hangs. Call `Page.bringToFront` and
  `Emulation.setFocusEmulationEnabled` before asserting.
- **Rects are 0 until render.** A canvas/leaf that was just opened or
  zoom-to-fitted has not laid out its nodes yet. Poll `isConnected` and a
  non-zero rect, or wait for the specific DOM node; do not click computed center
  coordinates from a stale read.
- **Prefer element-level events** when synthetic mouse coordinates miss:
  dispatch `pointerdown` / `pointerup` / `click` directly on the element, then
  assert plugin state through `app.plugins.plugins[id]` and the visible DOM.
- **Keyboard shortcuts need the right scope.** `Escape` closing a modal is
  handled by Obsidian's keymap before window/document capture handlers; a modal
  that must intercept it has to push a child `Scope` via
  `app.keymap.pushScope`.
- **Scope selectors to your plugin's DOM.** Broad selectors such as
  `.search-input-container input` can hit another view's hidden input: on one
  real run this wrote a filter into the file explorer's search box, hid the whole
  file tree, and the filter was persisted into `workspace.json` and survived a
  restart. Always query inside your own classes (`my-plugin-*`) and verify the
  target element belongs to the expected view.
- **Clean up after the run**: remove temporary nodes/notes/exports, detach
  pop-out leaves, reopen the user's original files, and re-check the visible UI
  (a screenshot) before reporting success.

## L4 — human/UI

The actual behaviour: commands appear, the modal opens, settings persist,
Markdown renders. An agent cannot claim L4 without a human or a screenshot.

## Honest reporting

- "unknown" is a valid result. Prefer it to a guess.
- A silent command success is not verification: confirm with a read-only query.
- When the reload command prints `Error:` it still exits 0 — classify by output text.
- An empty output can mean the call hung; treat it as timeout, not success.
