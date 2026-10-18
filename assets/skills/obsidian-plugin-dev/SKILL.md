---
name: obsidian-plugin-dev
description: Develop, build, deploy and validate an Obsidian community plugin with the obsidian_devkit_* tools, the official submission rules, and the layered verification loop (static -> isolated bundle smoke -> real vault). Use when creating or maintaining an Obsidian plugin, diagnosing why a plugin does not load, or preparing a plugin release.
whenToUse: Use when the task involves an Obsidian community plugin: new plugin, main.js/CommonJS build, manifest.json, settings tab, deployment to a vault, live reload through the official CLI, or a release/submission checklist. Not for plain Markdown vault editing.
license: MIT
---

# Obsidian plugin development

The eight `obsidian_devkit_*` tools do the mechanical work. This skill carries
the judgement: what the official rules are, in which order to run things, and
why a zero exit code is not proof that a plugin works.

## Workflow

1. **Scope** — decide the plugin id (lowercase, permanent), display name,
   description (<= 250 chars, ends with a period), and the minimum Obsidian
   version you actually test against. `minAppVersion` >= 1.13.0 unlocks the
   declarative settings API; below that you must ship a legacy `display()` tab.
2. **Scaffold** — `obsidian_devkit_scaffold` writes a buildable project. Pass
   `settingsStyle: "auto"` (default) unless you must support older apps.
3. **Install deps** — the scaffold does not install; run `pnpm install` (or the
   package manager you chose) in the generated directory.
4. **Develop** — keep the loop short:
   `obsidian_devkit_build` -> `obsidian_devkit_deploy` -> `obsidian_devkit_reload`
   (`action: "reload"`), with `obsidian_devkit_status` when anything smells
   wrong. The headless CLI route needs Obsidian running with the CLI enabled
   (Settings -> General -> Command line interface, Obsidian >= 1.12.4).
5. **Verify in layers** — never trust one layer:
   - L1 static: build exit code + CommonJS shape + manifest consistency
     (reported by `build`, audited by `validate`).
   - L2 isolated smoke: `obsidian_devkit_test` executes the bundle with a
     stubbed `obsidian` module and (scenario `onload`/`unload`) instantiates the
     plugin and calls the lifecycle hooks. Catches ESM output, a missing
     default export, a wrong prototype chain and import-time crashes.
   - L3 real vault: `deploy` writes the plugin and the app actually lists it;
     `status`/`reload` proof is read-only and reports "unknown" when the app
     cannot be reached.
   - L4 human check: the UI behaviour itself. Never claim L4 without a person
     or a screenshot.
6. **Version + release** — `obsidian_devkit_version` syncs manifest.json,
   package.json and versions.json. Release tag = manifest version (no `v`),
   GitHub release assets = `main.js`, `manifest.json`, `styles.css`.
7. **Submit** — see `reference/submission.md`; review is automated now, so the
   rules below are enforced mechanically.

## Tool map

| Tool | Use for |
| --- | --- |
| `obsidian_devkit_scaffold` | new project, official template set |
| `obsidian_devkit_build` | one-shot esbuild/tsc build, no watcher |
| `obsidian_devkit_validate` | pre-delivery audit (rules, sync, artifact) |
| `obsidian_devkit_version` | semver bump across the three files |
| `obsidian_devkit_deploy` | copy build into a vault, merge enable list, record binding |
| `obsidian_devkit_status` | read-only environment audit, deploy drift |
| `obsidian_devkit_reload` | CLI reload/rescan/enable/disable + read-only verify |
| `obsidian_devkit_test` | L2 isolated bundle smoke: load, instantiate, onload/unload |

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
- Never cold-start Obsidian, never steal window focus, never enable/disable a
  user's plugins without being asked. The CLI acts on the frontmost vault.
- Vault file writes go through `app.vault` APIs; never write with Node `fs`
  behind the app's back (Obsidian will not see the change).

## Reference

- `reference/submission.md` — naming, manifest, release and policy rules.
- `reference/settings.md` — declarative vs legacy settings.
- `reference/lifecycle.md` — onload/onunload, commands, events, vault writes.
- `reference/verification.md` — the layered loop and what each layer proves.
- `reference/debugging.md` — CLI quirks, hot reload, common failure signatures.
