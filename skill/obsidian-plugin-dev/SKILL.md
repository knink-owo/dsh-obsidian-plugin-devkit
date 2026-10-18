---
name: obsidian-plugin-dev
description: 'Develop, build, deploy and validate an Obsidian community plugin with the obsidian-devkit CLI, the official submission rules, and the layered verification loop (static checks, then an isolated bundle smoke, then a real vault). Use when creating or maintaining an Obsidian plugin, diagnosing why a plugin does not load, or preparing a plugin release.'
whenToUse: 'Use when the task involves an Obsidian community plugin: new plugin, main.js/CommonJS build, manifest.json, settings tab, deployment to a vault, live reload through the official CLI, or a release/submission checklist. Not for plain Markdown vault editing.'
license: MIT
---

# Obsidian plugin development

`obsidian-devkit` is a small Node CLI that does the mechanical work: scaffold,
build, validate, version, deploy, live reload, isolated smoke test, e2e harness.
This skill carries the judgement: the official rules, the order to run things,
and why a zero exit code is not proof that a plugin works.

## Prerequisites

Check the CLI before anything else:

```bash
obsidian-devkit --version
```

- Not installed? `npm install -g @knink-owo/dsh-obsidian-plugin-devkit`, or run it
  through `npx @knink-owo/dsh-obsidian-plugin-devkit <command>`.
- Working from a checkout? `npm install && npm run build && npm link` exposes the
  same `obsidian-devkit` command.
- If the CLI cannot be installed at all, follow `reference/cli.md` for the manual
  equivalents and say which layer you could not run.

Reports are printed in Chinese; rely on exit codes (`0` ok, `1` operation
failed, `2` usage error) rather than on parsing text.

## Workflow

1. **Scope** — decide the plugin id (lowercase, permanent), display name,
   description (<= 250 chars, ends with a period), and the minimum Obsidian
   version you actually test against. `minAppVersion` >= 1.13.0 unlocks the
   declarative settings API; below that you must ship a legacy `display()` tab.
2. **Scaffold** — `obsidian-devkit scaffold <dir> --id <id> --name "<Name>"`
   writes a buildable project (defaults: `--plugin-version 0.1.0`,
   `--min-app-version 1.13.0`, `--settings-style auto`, `--package-manager pnpm`).
3. **Install deps** — the scaffold does not install; run `pnpm install` (or the
   package manager you chose) in the generated directory.
4. **Develop** — keep the loop short:
   `obsidian-devkit build <dir>` -> `obsidian-devkit deploy <dir>` ->
   `obsidian-devkit reload <dir>`, with `obsidian-devkit status <dir>` when
   anything smells wrong. The reload route needs Obsidian running with the CLI
   enabled (Settings -> General -> Command line interface, Obsidian >= 1.12.4).
5. **Verify in layers** — never trust one layer:
   - L1 static: build exit code + CommonJS shape + manifest consistency
     (reported by `build`, audited by `validate`).
   - L2 isolated smoke: `obsidian-devkit test <dir>` executes the bundle with a
     stubbed `obsidian` module and (scenario `onload`/`unload`) instantiates the
     plugin and calls the lifecycle hooks. Catches ESM output, a missing default
     export, a wrong prototype chain and import-time crashes.
   - L3 real vault: `deploy` writes the plugin and the app actually lists it;
     `status`/`reload` proof is read-only and reports "unknown" when the app
     cannot be reached. For repeatable UI behaviour, `obsidian-devkit e2e <dir>`
     scaffolds a sandboxed WebdriverIO harness (isolated config dir + throwaway
     vault copy) — it writes and audits the harness but never runs it.
   - L4 human check: the UI behaviour itself. Never claim L4 without a person
     or a screenshot.
6. **Version + release** — `obsidian-devkit version <dir> <semver>` syncs
   manifest.json, package.json and versions.json. Release tag = manifest version
   (no `v`), GitHub release assets = `main.js`, `manifest.json`, `styles.css`.
7. **Submit** — see `reference/submission.md`; review is automated now, so the
   rules below are enforced mechanically.

## Command map

| Command | Use for |
| --- | --- |
| `obsidian-devkit scaffold <dir> --id --name` | new project, official template set |
| `obsidian-devkit build <dir>` | one-shot esbuild/tsc build, no watcher |
| `obsidian-devkit validate <dir>` | pre-delivery audit (rules, sync, artifact) |
| `obsidian-devkit version <dir> <semver>` | semver bump across the three files |
| `obsidian-devkit deploy <dir>` | copy build into a vault, merge enable list, record binding |
| `obsidian-devkit status [dir]` | read-only environment audit, deploy drift |
| `obsidian-devkit reload [dir]` | CLI reload/rescan/enable/disable + read-only verify |
| `obsidian-devkit test <dir>` | L2 isolated bundle smoke: load, instantiate, onload/unload |
| `obsidian-devkit e2e <dir>` | sandboxed WebdriverIO e2e harness: init/status, never runs the suite |

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
- Never cold-start Obsidian, never steal window focus, never enable/disable a
  user's plugins without being asked. The CLI acts on the frontmost vault.
- Vault file writes go through `app.vault` APIs; never write with Node `fs`
  behind the app's back (Obsidian will not see the change).

## Reference

- `reference/cli.md` — installation, full command/flag reference, env vars, exit codes.
- `reference/submission.md` — naming, manifest, release and policy rules.
- `reference/settings.md` — declarative vs legacy settings.
- `reference/lifecycle.md` — onload/onunload, commands, events, vault writes.
- `reference/verification.md` — the layered loop and what each layer proves.
- `reference/debugging.md` — CLI quirks, hot reload, common failure signatures.
