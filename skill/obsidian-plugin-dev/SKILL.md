---
name: obsidian-plugin-dev
description: 'Develop, build, deploy and validate an Obsidian community plugin with vendored local scripts, the official submission rules, and the layered verification loop (static checks, then an isolated bundle smoke, then a real vault). Includes the community.obsidian.md submission flow and the Canvas/DevTools probing rules learned from real releases. Use when creating or maintaining an Obsidian plugin, diagnosing why a plugin does not load, or preparing a plugin release.'
whenToUse: 'Use when the task involves an Obsidian community plugin: new plugin, main.js/CommonJS build, manifest.json, settings tab, deployment to a vault, live reload through the official Obsidian CLI, release/submission through community.obsidian.md, scripted UI verification over CDP, or plugins that extend Canvas internals. Not for plain Markdown vault editing.'
license: MIT
---

# Obsidian plugin development

`scripts/devkit.mjs` is a vendored Node runtime that does the mechanical work:
scaffold, build, validate, version, deploy, live reload, isolated smoke test, e2e
harness. It is self-contained: no global CLI and no `npm install` for the skill
itself. This skill carries the judgement: the official rules, the order to run
things, and why a zero exit code is not proof that a plugin works.

## Prerequisites

Check the vendored runtime before anything else:

```bash
node scripts/devkit.mjs --version
```

- The scripts live in this skill's `scripts/` folder and ship with it. If they
  are missing, the skill installation is incomplete: copy the whole
  `obsidian-plugin-dev` folder again.
- No `npm install -g`, no `npx`, no `npm link`. The only requirement is
  Node.js >= 20.
- Reports are printed in Chinese and may still say `obsidian-devkit`; execute
  the local entry `node scripts/devkit.mjs` and rely on exit codes (`0` ok, `1`
  operation failed, `2` usage error) rather than parsing text.

## Workflow

1. **Scope** — decide the plugin id (lowercase, permanent), display name,
   description (<= 250 chars, ends with a period), and the minimum Obsidian
   version you actually test against. `minAppVersion` >= 1.13.0 unlocks the
   declarative settings API; below that you must ship a legacy `display()` tab.
2. **Scaffold** — `node scripts/devkit.mjs scaffold <dir> --id <id> --name "<Name>"`
   writes a buildable project (defaults: `--plugin-version 0.1.0`,
   `--min-app-version 1.13.0`, `--settings-style auto`, `--package-manager pnpm`).
3. **Install deps** — the scaffold does not install the *plugin's* dependencies;
   run `pnpm install` (or the package manager you chose) in the generated
   directory. This is separate from the skill's own zero-install runtime.
4. **Develop** — keep the loop short:
   `node scripts/devkit.mjs build <dir>` -> `node scripts/devkit.mjs deploy <dir>`
   -> `node scripts/devkit.mjs reload <dir>`, with
   `node scripts/devkit.mjs status <dir>` when anything smells wrong. The reload
   route needs Obsidian running with the official CLI enabled (Settings ->
   General -> Command line interface, Obsidian >= 1.12.4).
5. **Verify in layers** — never trust one layer:
   - L1 static: build exit code + CommonJS shape + manifest consistency
     (reported by `build`, audited by `validate`).
   - L2 isolated smoke: `node scripts/devkit.mjs test <dir>` executes the bundle
     with a stubbed `obsidian` module and (scenario `onload`/`unload`)
     instantiates the plugin and calls the lifecycle hooks. Catches ESM output,
     a missing default export, a wrong prototype chain and import-time crashes.
   - L3 real vault: `deploy` writes the plugin and the app actually lists it;
     `status`/`reload` proof is read-only and reports "unknown" when the app
     cannot be reached. For repeatable UI behaviour,
     `node scripts/devkit.mjs e2e <dir>` scaffolds a sandboxed WebdriverIO
     harness (isolated config dir + throwaway vault copy) — it writes and audits
     the harness but never runs it.
   - L4 human check: the UI behaviour itself. Never claim L4 without a person
     or a screenshot.
6. **Version + release** — `node scripts/devkit.mjs version <dir> <semver>`
   syncs manifest.json, package.json and versions.json. Release tag = manifest
   version (no `v`), GitHub release assets = `main.js`, `manifest.json`,
   `styles.css`. The tag can drive CI, but verify the published files rather
   than the Actions UI: download the release assets and compare hashes
   (`gh release download`, then sha256). A run can show a stale `queued` state
   while the release already exists. See `reference/submission.md`.
7. **Submit** — through <https://community.obsidian.md>, not a pull request.
   `obsidianmd/obsidian-releases` mirrors `community-plugins.json` hourly, so a
   manual PR is overwritten. A human signs in with an Obsidian account, links
   the owning GitHub account, and adds the plugin; an automated review follows
   the manifest at the HEAD of the default branch. See
   `reference/submission.md`.

## Command map

All commands are run from the skill folder (or prefix the path to
`scripts/devkit.mjs` when running from elsewhere).

| Command | Use for |
| --- | --- |
| `node scripts/devkit.mjs scaffold <dir> --id --name` | new project, official template set |
| `node scripts/devkit.mjs build <dir>` | one-shot esbuild/tsc build, no watcher |
| `node scripts/devkit.mjs validate <dir>` | pre-delivery audit (rules, sync, artifact) |
| `node scripts/devkit.mjs version <dir> <semver>` | semver bump across the three files |
| `node scripts/devkit.mjs deploy <dir>` | copy build into a vault, merge enable list, record binding |
| `node scripts/devkit.mjs status [dir]` | read-only environment audit, deploy drift |
| `node scripts/devkit.mjs reload [dir]` | CLI reload/rescan/enable/disable + read-only verify |
| `node scripts/devkit.mjs test <dir>` | L2 isolated bundle smoke: load, instantiate, onload/unload |
| `node scripts/devkit.mjs e2e <dir>` | sandboxed WebdriverIO e2e harness: init/status, never runs the suite |

For every flag, environment variable and exit code see `reference/cli.md`.

## Hard rules

- The plugin bundle is **CommonJS** and `obsidian` is **external**; the
  `electron`, `@codemirror/*` and `@lezer/*` modules are external too.
- No obfuscation, no ads, no client-side telemetry, no self-update, no loading
  remote code. Fetching data from a server your plugin documents is fine.
- The manifest `id` is permanent: it must equal the installed folder name and
  must never change after the first release.
- `minAppVersion` must be a version you actually test; the declarative settings
  API needs 1.13.0+.
- The release tag must equal `manifest.json` version exactly.
- Do not open a pull request against `obsidianmd/obsidian-releases` to publish a
  plugin; submissions go through `community.obsidian.md` (the JSON file there is
  a mirror).
- Scripted UI tests must not leave the user's workspace changed: no stray nodes,
  notes, tabs, pop-outs, filters or plugin toggles. Restore the layout and
  verify it in a screenshot when done.
- Never cold-start Obsidian, never steal window focus, never enable/disable a
  user's plugins without being asked. The scripts act on the frontmost vault.
- Vault file writes go through `app.vault` APIs; never write with Node `fs`
  behind the app's back (Obsidian will not see the change).

## Reference

- `scripts/README.md` — vendored runtime, version, no-install usage, update path.
- `reference/cli.md` — full command/flag reference, env vars, exit codes, and the
  manual fallback when the scripts cannot run.
- `reference/submission.md` — naming, manifest, release and policy rules.
- `reference/settings.md` — declarative vs legacy settings.
- `reference/lifecycle.md` — onload/onunload, commands, events, vault writes.
- `reference/verification.md` — the layered loop and what each layer proves,
  including scripted UI probing over the DevTools protocol (L3.5).
- `reference/debugging.md` — runtime quirks, hot reload, common failure signatures.
- `reference/canvas.md` — verified map of Canvas internals for plugins that add
  card/node chrome, plus the click/DOM-sync rules.
