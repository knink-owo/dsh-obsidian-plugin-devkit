# dsh-obsidian-plugin-devkit

**DeepSeek Harness (DSH) tools for developing Obsidian community plugins.**

This bundle teaches a DSH agent how to scaffold, build, validate, version, deploy and live-reload an
Obsidian community plugin correctly, so the plugin it produces can be loaded in Obsidian and
submitted to the community directory without name/description/version rejections. It never runs a
background watcher, never starts Obsidian on its own and never touches a vault the user did not point
it at.

> Status: **v0.4.0 (M2 in progress)** — scaffold, build, validate, version, deploy to a vault,
> environment status, CLI-backed reload, an isolated L2 bundle smoke test, plus the bundled
> `obsidian-plugin-dev` development-guideline skill and an injected session context. The sandboxed
> e2e runner (WebdriverIO + wdio-obsidian-service) arrives later in M2.

## Install

```bash
# from a local checkout (linked into the profile):
dsh plugin --profile <profile> add D:\Projects\dsh-obsidian-devkit
# or, once published:
dsh plugin --profile <profile> add @knink-owo/dsh-obsidian-plugin-devkit
```

The bundle is host-only (no UI half). Tools appear in every new agent session after the profile
reloads.

## Tools

| Tool | What it does |
| --- | --- |
| `obsidian_devkit_scaffold` | Generates a buildable project: `manifest.json`, `package.json`, `esbuild.config.mjs`, `tsconfig.json`, `eslint.config.mts`, `versions.json`, `version-bump.mjs`, `LICENSE`, `README.md`, `AGENTS.md`, `styles.css`, `src/main.ts` + `src/settings.ts`. Rejects metadata the community reviewers reject. |
| `obsidian_devkit_build` | Runs the project's `build` script (or the local esbuild binary) once, then statically checks the artifact: present, CommonJS-shaped, version-synced, settings gate consistent. |
| `obsidian_devkit_validate` | Read-only pre-delivery audit: naming rules, manifest constraints, semver, version sync, entry file, bundle shape, declarative-settings gate, release checklist. |
| `obsidian_devkit_version` | Bumps `manifest.json`, `package.json` and `versions.json` together (optionally raising `minAppVersion`) and reports exactly what changed. |
| `obsidian_devkit_deploy` | Copies `main.js` / `manifest.json` / `styles.css` into `<vault>/.obsidian/plugins/<id>/`, merges the id into `community-plugins.json` (never replaces the list) and records `.dsh/devkit.json`. Needs no running app; defaults to a workspace `dev-vault` created on demand; `dryRun` previews. |
| `obsidian_devkit_status` | Read-only environment audit: Obsidian running? CLI available and which version? registered vaults, project build state, where the plugin is deployed, drift between build and deployed copy, and what the running app actually sees. Every unknown is reported as unknown, with the reason. |
| `obsidian_devkit_reload` | Acts on a running Obsidian through the official CLI: `reload` after a build, `rescan` to discover newly deployed plugins, `enable` / `disable`. Verifies with a read-only query and reports CLI quirks honestly (exit code 0 on errors, silent hang). |
| `obsidian_devkit_test` | Read-only L2 smoke test: loads the built `main.js` in an isolated Node VM with a stubbed `obsidian` module, then optionally instantiates the plugin and calls `onload()`/`onunload()` (with a timeout). Catches ES-module output, a missing default export, a wrong prototype chain, import-time crashes and obvious onload hangs. Never a substitute for L3/L4. |

Every report is Markdown in Chinese; code, member names and tool identifiers stay English.

## Deployment and live reload

Two independent channels, and the reports never mix them up:

1. **File-level deploy** (`obsidian_devkit_deploy`) — works with Obsidian closed. It writes only the
   three files Obsidian loads, keeps existing entries in `community-plugins.json`, and says
   `active: unknown` unless it can prove otherwise.
2. **Official CLI** (`obsidian_devkit_status`, `obsidian_devkit_reload`) — requires Obsidian
   **1.12.4+** with *Settings → General → Command line interface* enabled and the app already
   running. Window-scoped commands act on the frontmost vault, so the report warns when the target
   vault is not focused. The tool never cold-starts Obsidian, never steals focus, and never falls
   back to window-handle tricks: without the CLI it refuses and points at the file-level channel.

If `obsidian` is not on `PATH`, set `OBSIDIAN_CLI` to the executable (for example
`...\Obsidian\Obsidian.com`) or configure `obsidianCli` below.

## Skill and session context

Two optional host services are used when present; both are strictly best-effort, so a host without
them keeps the eight tools and loses nothing else:

- **`obsidian-plugin-dev` skill** — registered through `skills.register` with `source: "runtime"`. Its
  body is the development workflow; `assets/skills/obsidian-plugin-dev/reference/` carries the
  official submission rules, the declarative-vs-legacy settings gate, lifecycle/API patterns, the
  layered verification loop (L1 static → L2 isolated smoke → L3 real vault → L4 human check) and the
  CLI debugging quirks. The skill directory is exposed as the resource base, so reference files load
  on demand instead of inflating the tool list.
- **Session context** — one `systemPrompt` context entry (`obsidian-plugin-devkit`, order 250) that
  states the safety boundaries: never cold-start Obsidian, never steal focus, never enable/disable a
  user's plugins unasked, report "unknown" instead of guessing, and verify in layers.

The context text lives in `assets/docs/harness.default.md` so it can be edited without a rebuild;
the compiled-in fallback keeps registration working if the asset is missing. Both registrations are
skipped silently when the host service is absent and logged (not thrown) when a host rejects them.

## Scaffold layouts

- **Declarative settings** (default when `minAppVersion >= 1.13.0`): the settings tab overrides
  `getSettingDefinitions(): SettingDefinitionItem[]`, which Obsidian turns into a settings UI and
  binds to `plugin.settings` through `getControlValue`/`setControlValue`.
- **Legacy settings** (`minAppVersion < 1.13.0`): the generated tab implements `display()` with
  `new Setting(...)`. Pick this whenever the plugin must run on older Obsidian versions.

`settingsStyle: "auto"` decides from `minAppVersion`; the explicit values override it, and the
validator blocks a declarative tab below Obsidian 1.13.0.

## Configuration

`cordis.patch.yml` mounts the bundle with:

```yaml
config:
  defaultMinAppVersion: 1.13.0
  testVault: dev-vault
  packageManager: pnpm
  obsidianCli: obsidian
  probeActive: true
```

- `testVault` — workspace-relative development vault used by `deploy` when no vault is given.
- `packageManager` — fallback for running a project build script when no lockfile decides.
- `obsidianCli` — CLI invocation; `"obsidian"` resolves through `PATH`, an absolute path pins one
  install (the `OBSIDIAN_CLI` environment variable wins over both).
- `probeActive` — whether `deploy` performs the read-only running-app probe after writing files.

## Development

```bash
npm install
npm run build      # tsc -> lib/
npm test           # node --test over the suites (no child processes needed)
```

Notes for this repository's test setup: the test runner uses `--test-isolation=none` because the
DSH sandbox forbids Node's default per-file child process. Tests use the Node `fs` fallback of
`Fs` (no DSH context needed).

## DSH contract notes

Tool schemas must be object-root JSON Schema (``parameters: { type: "object", properties, ... }``)
because the harness projects them verbatim to the model API, and `isConcurrencySafe` is a function.
The full checklist and the M1 schema-bug postmortem live in
[docs/dsh-plugin-guide.zh.md](docs/dsh-plugin-guide.zh.md).

## Layout

```
src/                 host plugin: index.ts (cordis entry), tools, fs wrapper, proc runner,
                     cli/vault/deploy/status/reload channels, skill + context registration
assets/templates/    files written by scaffold (placeholders like {{PLUGIN_ID}})
assets/skills/       obsidian-plugin-dev SKILL.md + reference/ (registered into `skills`)
assets/docs/         harness.default.md (injected session context text)
lib/                 compiled output (gitignored)
docs/                research notes and the design proposal
test/                node:test suites
cordis.patch.yml     bundle patch: insert { id: obsidian-plugin-devkit, ... }
```

## Roadmap

- **M1 (done)** scaffold / build / validate / version.
- **M2 (in progress)** deploy to a development vault, `status`/`reload` via the official CLI, the
  `obsidian-plugin-dev` skill + session context, and the read-only L2 `test` smoke tool — implemented
  and tested (86 tests). Still to come: sandboxed e2e (WebdriverIO + wdio-obsidian-service).
- **M3** API reference resource and submission automation.

## License

MIT © 2026 knink-owo
