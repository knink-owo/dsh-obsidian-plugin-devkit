# Debugging an Obsidian plugin

## The official CLI (Obsidian >= 1.12.4)

Enable it in Settings -> General -> Command line interface; the installer adds
the `obsidian` executable to `PATH`. The app must already be running — the
first command of the day can cold-start it, which an agent must never trigger.

Quirks that matter more than the command list:

- **Exit code is not the result.** The CLI prints `Error: ...` and still exits
  0. Classify by the printed text, not `$?`.
- **An empty result may be a hang.** Wrap every call in a timeout; a plugin
  reload that prints nothing may simply never have answered.
- **Window commands act on the frontmost vault.** `vault=<name>` is accepted by
  some commands but is not a guarantee for window-scoped ones. Check
  `app.vault.getName()` first if correctness depends on the vault.
- **Plugin discovery happens once, at vault load.** A folder deployed after load
  is invisible until `app.plugins.loadManifests()` (rescan) runs.
- **Restricted mode is per vault** (Settings -> Community plugins), tracked in
  the app's localStorage, not in a file you can safely edit.
- **Never force the window forward** to make an inspection work; that steals
  the user's focus. A hidden window renders nothing, so a screenshot of it is
  meaningless.

Useful commands: `version`, `vaults verbose`, `plugins:enabled filter=community
format=json`, `plugin id=<id>`, `plugin:reload id=<id>`, `plugins:restrict
on|off`, `dev:errors`, `dev:console`, `dev:dom`, `dev:css`, `dev:screenshot`,
`eval code=<js>`.

## Hot reload during development

The community "Hot Reload" plugin is the usual workflow; a plain manual loop is
also fine: build -> deploy (copy the three artifacts) -> toggle the plugin off
and on (or restart the app). The `reload` tool wraps the CLI route when the app
is reachable.

## Symptom -> action

| Symptom | Likely cause | First move |
| --- | --- | --- |
| Plugin missing from the list | folder/id mismatch, discovery not rescanned, restricted mode | check `.obsidian/plugins/<id>/manifest.json`; rescan; check community-plugins.json |
| Listed but disabled | id not in `community-plugins.json`, restricted mode | deploy with enable, or enable via CLI |
| "Failed to load plugin" | `main.js` is ESM, throws at import, `require` missing | L1 build check; L2 smoke; app `dev:errors` |
| Old code keeps running | Obsidian caches the bundle; only reload swaps it | build, deploy, then `plugin:reload` |
| Settings empty on old app | declarative tab with `minAppVersion` < 1.13.0 | ship legacy `display()` or raise `minAppVersion` |
| Command does nothing | `checkCallback` returned false, or wrong view leaf | check active view; log inside the callback |
| Vault edits missing | wrote through Node `fs` | use `app.vault` APIs |
