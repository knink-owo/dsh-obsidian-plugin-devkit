# Layered verification

One green build proves almost nothing. Check each layer, and never promote a
claim to the next layer without evidence at the current one.

## L1 — static (tool: `build`, `validate`)

- Build exits 0 and emits `main.js`.
- `main.js` is CommonJS: it has `module.exports` / `exports.` and a
  `require("obsidian")`-shaped external reference, not top-level `import`.
- `manifest.json`, `package.json` and `versions.json` agree; the manifest id is
  submission-safe; the settings style matches `minAppVersion`.
- `validate` warnings are real findings, not trivia; fix or knowingly accept
  each one.

## L2 — isolated smoke (tool: `test`, when available)

Load the bundle in a sandbox with a stubbed `obsidian` module: constructing the
plugin and calling `onload`/`onunload` must not throw, and the default export
must extend the stubbed `Plugin`. This catches import-time crashes, missing
exports and wrong module format. It does not prove real-API compatibility.

## L3 — real vault (tools: `deploy`, `status`, `reload`)

- `deploy` writes `main.js`, `manifest.json`, `styles.css` into
  `<vault>/.obsidian/plugins/<id>/` and merges the id into
  `community-plugins.json` without replacing other entries.
- The app lists the plugin as *enabled* (read-only proof via the CLI), and the
  app's *active vault* is the target vault — commands act on the frontmost
  window, so a different foreground vault means "unknown", not "failed".
- Reload/rescan paths need Obsidian running with the CLI enabled
  (>= 1.12.4). If any of that is missing, report the limitation; never open the
  app yourself and never pretend it worked.

## L4 — human/UI

The actual behaviour: commands appear, the modal opens, settings persist,
Markdown renders. An agent cannot claim L4 without a human or a screenshot.

## Honest reporting

- "unknown" is a valid result. Prefer it to a guess.
- A silent CLI success is not verification: confirm with a read-only query.
- When the CLI prints `Error:` it still exits 0 — classify by output text.
- An empty output can mean the call hung; treat it as timeout, not success.
