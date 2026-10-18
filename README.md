# dsh-obsidian-plugin-devkit

**DeepSeek Harness (DSH) tools for developing Obsidian community plugins.**

This bundle teaches a DSH agent how to scaffold, build, validate and version an Obsidian community
plugin correctly, so the plugin it produces can be loaded in Obsidian and submitted to the community
directory without name/description/version rejections. It only adds four tools; it never touches your
vault and never runs a watcher.

> Status: **v0.1.1 (M1)** — scaffold, build, validate, version. Deployment to a development vault,
> `status`/`reload`, sandboxed e2e and the model-facing skill arrive in M2.

## Install

```bash
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

Every report is Markdown in Chinese; code, member names and tool identifiers stay English.

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
  enableCli: true
```

`enableCli` is accepted for M2 (official Obsidian CLI integration); M1 tools do not spawn Obsidian.

## Development

```bash
npm install
npm run build      # tsc -> lib/
npm test           # build + node --test (no child processes needed)
```

Notes for this repository's test setup: the test runner uses `--test-isolation=none` because the
DSH sandbox forbids Node's default per-file child process. Tests use the Node `fs` fallback of
`Fs` (no DSH context needed).

## DSH contract notes

Tool schemas must be object-root JSON Schema (), and
 is a function. The full checklist and the M1 schema-bug postmortem live in
[docs/dsh-plugin-guide.zh.md](docs/dsh-plugin-guide.zh.md).

## Layout

```
src/                 host plugin: index.ts (cordis entry), tools, fs wrapper, proc runner
assets/templates/    files written by scaffold (placeholders like {{PLUGIN_ID}})
lib/                 compiled output (gitignored)
docs/                research notes and the design proposal
test/                node:test suites
cordis.patch.yml     bundle patch: insert { id: obsidian-plugin-devkit, ... }
```

## Roadmap

- **M1 (done)** scaffold / build / validate / version.
- **M2** deploy to a development vault, `status`/`reload` via the official CLI, sandboxed e2e
  (WebdriverIO + wdio-obsidian-service), and the `obsidian-plugin-dev` skill + harness context.
- **M3** API reference resource and submission automation.

## License

MIT © 2026 knink-owo
