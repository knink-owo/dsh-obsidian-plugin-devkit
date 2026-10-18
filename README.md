# obsidian-plugin-devkit

**Build Obsidian community plugins the way reviewers expect — from the terminal or from an agent.**

This repository ships two things that share one core:

1. **`obsidian-devkit`** — a small Node CLI (10 commands) that scaffolds, builds, validates, versions,
   deploys, live-reloads, smoke-tests and e2e-scaffolds an Obsidian community plugin. It encodes the
   official submission rules so a project is rejected *before* you write it.
2. **`obsidian-plugin-dev`** — an agent skill that teaches a coding agent the judgement part: the
   layered verification loop, the official naming/release rules, the CLI quirks, and the safety
   boundaries (never cold-start Obsidian, never steal focus, never touch a vault you were not given).

> Status: **v1.0.0** — CLI + skill. The former DSH (Cordis) plugin bundle is archived in
> [`archive/plugin/`](archive/plugin/README.md) at git tag `archive-plugin-v0.5.0`.

## Why a CLI instead of a plugin

The original delivery was a DeepSeek Harness host bundle with nine `obsidian_devkit_*` tools. Almost
all of that logic was already plain Node — only the host wrapper was harness-specific. The plugin
form cost a profile install, a host-module reload after every change, and a coupling to the host tool
API, while the actual capability is "run these checks on a plugin project".

So v1.0.0 keeps the proven core and exposes it twice: as a normal CLI for humans, CI and scripts, and
as a skill for agents (which bring their own shell). The plugin bundle is preserved for reference
only.

## Install

```bash
# CLI (Node >= 20)
npm install -g @knink-owo/dsh-obsidian-plugin-devkit
obsidian-devkit --version

# or without installing
npx @knink-owo/dsh-obsidian-plugin-devkit --version

# from a checkout
npm install && npm run build && npm link
```

Install the agent skill into the DSH skills directory (default `~/.dsh/skills`, or `$DSH_HOME/skills`,
or `$OBSIDIAN_DEVKIT_SKILLS_DIR`):

```bash
obsidian-devkit install-skill          # --force to replace, --skills-dir <dir> to override
```

A skill installed this way is discovered by the harness like any other skill; the skill body tells
the agent when and how to call `obsidian-devkit`.

Optional, for live reload only: Obsidian **>= 1.12.4** with *Settings → General → Command line
interface* enabled and the app already running. Everything else works with Obsidian closed.

## Quick start

```bash
obsidian-devkit scaffold ./my-plugin --id my-plugin --name "My Plugin" --author "Jane"
cd my-plugin && pnpm install
obsidian-devkit build .
obsidian-devkit test .              # L2 isolated smoke (no Obsidian needed)
obsidian-devkit deploy .            # writes into the workspace dev-vault
obsidian-devkit reload .            # if Obsidian is running with the CLI enabled
obsidian-devkit validate .          # pre-delivery audit
```

Reports are Chinese Markdown; the exit code is the machine signal (`0` ok, `1` failed, `2` usage).
Every command is documented in the skill's `reference/cli.md` and in `obsidian-devkit help`.

## Commands

| Command | What it does |
| --- | --- |
| `scaffold <dir> --id --name` | Buildable project from the official template set: `manifest.json`, `package.json`, `esbuild.config.mjs`, `tsconfig.json`, `eslint.config.mts`, `versions.json`, `version-bump.mjs`, `LICENSE`, `README.md`, `AGENTS.md`, `styles.css`, `src/main.ts` + `src/settings.ts`. Rejects names/descriptions reviewers reject. |
| `build <dir>` | One-shot build (project `build` script, else local esbuild), then static checks: artifact present, CommonJS-shaped, version-synced, settings gate consistent. No watcher. |
| `validate <dir>` | Read-only pre-delivery audit: naming, manifest constraints, semver, version sync, entry, bundle shape, declarative-settings gate, release checklist. |
| `version <dir> <semver>` | Syncs `manifest.json`, `package.json` and `versions.json` (optionally raises `minAppVersion`) and reports every changed file. |
| `deploy <dir>` | Copies `main.js` / `manifest.json` / `styles.css` into `<vault>/.obsidian/plugins/<id>/`, merges the id into `community-plugins.json` (never replaces the list), records `.dsh/devkit.json`. Works with Obsidian closed; defaults to a workspace `dev-vault`; `--dry-run` previews. |
| `status [dir]` | Read-only audit: Obsidian running? CLI version? registered vaults, project build state, deployments, drift between build and deployed copy, what the running app sees. Unknowns stay unknown, with the reason. |
| `reload [dir]` | Official CLI only: `reload` / `rescan` / `enable` / `disable`. Verifies with a read-only query; reports CLI quirks honestly (errors exit 0, hangs print nothing). |
| `test <dir>` | L2 smoke: loads the built `main.js` in an isolated Node VM with stubbed `obsidian`/`electron`/CodeMirror modules; optionally instantiates and calls `onload`/`onunload` under a timeout. |
| `e2e <dir>` | Writes or audits a **sandboxed** WebdriverIO + wdio-obsidian-service harness (isolated config dir, throwaway vault copy, generated spec, merged devDependencies). Never runs the suite. |
| `install-skill` | Copies the bundled `obsidian-plugin-dev` skill into a DSH skills directory. |

### Deployment vs live reload

Two independent channels, and the reports never mix them up:

1. **File-level deploy** — works with Obsidian closed. It writes only the three files Obsidian loads,
   keeps existing `community-plugins.json` entries, and reports `active: unknown` unless it can prove
   otherwise.
2. **Official CLI** — requires Obsidian 1.12.4+ with the CLI enabled and running. Window-scoped
   commands act on the frontmost vault, so the report warns when the target vault is not active. The
   tool never cold-starts Obsidian and never falls back to window-handle tricks; without the CLI it
   refuses and points at the file-level channel.

If `obsidian` is not on `PATH`, set `OBSIDIAN_CLI` (for example to
`...\Obsidian\Obsidian.com`) or pass `--obsidian-cli`.

### Verification layers

A green build proves almost nothing. The skill enforces four layers:

- **L1 static** — `build` / `validate`: artifact, CommonJS shape, manifest and version sync.
- **L2 isolated smoke** — `test`: bundle executes against stubs; catches ESM output, missing default
  export, wrong prototype chain, import-time crashes, onload hangs.
- **L3 real vault** — `deploy` + `status` / `reload`: the app lists the plugin; proofs stay read-only.
  `e2e` scaffolds a repeatable UI harness, but running it is a human/CI decision.
- **L4 human/UI** — actual behaviour; an agent never claims it without a human or a screenshot.

## The skill

[`skill/obsidian-plugin-dev/`](skill/obsidian-plugin-dev/SKILL.md) is self-contained: `SKILL.md` is
the workflow and the hard rules, `reference/cli.md` is the complete CLI fallback reference, and
`reference/{submission,settings,lifecycle,verification,debugging}.md` carry the official rules and the
API patterns. `install-skill` copies it into a skills directory; the agent loads the reference files
on demand.

The skill also states the non-negotiable boundaries: never cold-start Obsidian, never steal focus,
never enable/disable a user's plugins unasked, report "unknown" instead of guessing, and never write a
vault with Node `fs` behind the app's back.

## Template and settings styles

- **Declarative settings** (default when `minAppVersion >= 1.13.0`): the settings tab overrides
  `getSettingDefinitions(): SettingDefinitionItem[]`, which Obsidian renders and binds to
  `plugin.settings` through `getControlValue`/`setControlValue`.
- **Legacy settings** (`minAppVersion < 1.13.0`): the generated tab implements `display()` with
  `new Setting(...)`.
- `--settings-style auto|declarative|legacy` overrides the choice; `validate` blocks a declarative tab
  below Obsidian 1.13.0.

## Repository layout

```
src/                 CLI core: commandline.ts + scaffold/build/validate/version/deploy/status/
                     reload/test/e2e modules, naming rules, vault + CLI channels, templates
assets/templates/    files written by scaffold (placeholders like {{PLUGIN_ID}})
skill/               obsidian-plugin-dev SKILL.md + reference/
docs/                research notes, the design proposal, DSH plugin guide (historical)
archive/plugin/      archived DSH (Cordis) plugin bundle, v0.5.0
test/                node:test suites (89 tests, no child processes)
lib/                 compiled output (gitignored)
```

## Development

```bash
npm install
npm run build      # tsc -> lib/
npm test           # node --test, 89 tests
npm pack --dry-run # verify the published file set
```

The bundled test runner uses `--test-isolation=none` because the DSH sandbox forbids Node's default
per-file child process; the suites exercise the library directly through the `Fs` Node fallback.

## Roadmap

- **v1.0.0 (this)** — CLI (10 commands) + agent skill; the DSH plugin bundle archived.
- **v1.1** — API-reference resource for the Obsidian TypeScript API (offline search for the agent),
  submission automation.
- **Later** — npm publish, GitHub release workflow.

## License

MIT © 2026 knink-owo
