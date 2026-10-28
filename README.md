# obsidian-plugin-devkit

**Build Obsidian community plugins the way reviewers expect — from the terminal or from an agent.**

This repository ships two things that share one core:

1. **The devkit runtime** — plain Node scripts (nine commands) that scaffold, build, validate, version,
   deploy, live-reload, smoke-test and e2e-scaffold an Obsidian community plugin. It encodes the
   official submission rules so a project is rejected *before* you write it.
2. **`obsidian-plugin-dev`** — a self-contained agent skill that teaches a coding agent the judgement
   part: the layered verification loop, the official naming/release rules, the runtime quirks, and the
   safety boundaries (never cold-start Obsidian, never steal focus, never touch a vault you were not
   given). Its `scripts/` folder carries the runtime, so installing the skill needs no global CLI.

> Status: **v1.1.0** — runtime + self-contained skill. v1.1.0 is a content pass on the skill:
> verify release assets instead of the Actions UI (`queued` ghost runs), submit through
> community.obsidian.md instead of a pull request, and two new references — Canvas internals and
> L3.5 scripted UI probing over CDP. The former DSH (Cordis) plugin bundle is archived in
> [`archive/plugin/`](archive/plugin/README.md) at git tag `archive-plugin-v0.5.0`.

## Why scripts inside the skill

The original delivery was a DeepSeek Harness host bundle with nine `obsidian_devkit_*` tools. Almost
all of that logic was already plain Node — only the host wrapper was harness-specific. v1.0.0 keeps
the proven core and ships it **inside the skill** as `scripts/`, with an optional CLI face for humans
and CI.

The skill therefore works from a folder copy: no npm registry package, no global install, no network
at runtime beyond what the plugin project itself needs.

## Use it

**From the skill (recommended for agents):**

```bash
cd skill/obsidian-plugin-dev
node scripts/devkit.mjs --version
node scripts/devkit.mjs scaffold ./my-plugin --id my-plugin --name "My Plugin" --author "Jane"
```

**From a checkout (for humans/CI):**

```bash
npm install
npm run build            # also runs scripts/sync-skill-runtime.mjs
node lib/commandline.js --version
# optional: npm link      -> obsidian-devkit
```

There is no required global install. The skill's `scripts/` folder is fully self-contained (Node >=
20, no third-party runtime dependencies); `node scripts/devkit.mjs` works without `npm install`.

To install the skill, copy the whole `skill/obsidian-plugin-dev/` folder into your skills directory
(for DSH: `~/.dsh/skills/`). The runtime travels in `scripts/`; there is nothing else to install.

Optional, for live reload only: Obsidian **>= 1.12.4** with *Settings → General → Command line
interface* enabled and the app already running. Everything else works with Obsidian closed.

## Quick start

```bash
cd skill/obsidian-plugin-dev
node scripts/devkit.mjs scaffold ./my-plugin --id my-plugin --name "My Plugin" --author "Jane"
cd my-plugin && pnpm install
node ../scripts/devkit.mjs build .
node ../scripts/devkit.mjs test .       # L2 isolated smoke (no Obsidian needed)
node ../scripts/devkit.mjs deploy .     # writes into the workspace dev-vault
node ../scripts/devkit.mjs reload .     # if Obsidian is running with its CLI enabled
node ../scripts/devkit.mjs validate .   # pre-delivery audit
```

Reports are Chinese Markdown; the exit code is the machine signal (`0` ok, `1` failed, `2` usage).
Some report strings still say `obsidian-devkit`; execute the local `scripts/devkit.mjs` entry. Every
command is documented in [`skill/obsidian-plugin-dev/reference/cli.md`](skill/obsidian-plugin-dev/reference/cli.md)
and in `node scripts/devkit.mjs help`.


## Commands

Run these through `node scripts/devkit.mjs <command>` from the skill folder, or
`node lib/commandline.js <command>` from a built checkout.

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
the workflow and the hard rules, `scripts/` is the vendored runtime, `reference/cli.md` is the complete
command fallback reference, and `reference/{submission,settings,lifecycle,verification,debugging,canvas}.md`
carry the official rules, the API patterns and the verified Canvas internals. Copy the folder into a
skills directory; the agent loads the reference files on demand. There is no `install-skill` step and
no global CLI required.

> Legacy note: the built `lib/commandline.js` still accepts an `install-skill` subcommand for older
> devkit users, and some report strings still say `obsidian-devkit`. The supported path is
> `node scripts/devkit.mjs`; `install-skill` is not part of the skill workflow.

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

- **v1.0.0** — CLI (10 commands) + agent skill; the DSH plugin bundle archived.
- **v1.1.0 (this)** — skill content pass: release-asset hash verification and `queued` ghost runs,
  community.obsidian.md submission flow, `reference/canvas.md`, L3.5 scripted UI probing over CDP.
- **v1.2** — API-reference resource for the Obsidian TypeScript API (offline search for the agent),
  submission automation.
- **Later** — npm publish, GitHub release workflow.

## License

MIT © 2026 knink-owo
