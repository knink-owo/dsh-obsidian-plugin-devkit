# `scripts/devkit.mjs` reference

The skill ships its own runtime in `scripts/`. There is no global
`obsidian-devkit` command to install and no package to fetch. Run the local
entry from the skill folder:

```bash
node scripts/devkit.mjs --version
```

If you are running from another directory, prefix the path:

```bash
node <skills-dir>/obsidian-plugin-dev/scripts/devkit.mjs --version
```

The runtime is plain Node (>= 20) and has no third-party runtime dependencies.
It needs no Obsidian running except for `reload`, and no network except when
the project's own `install`/`build` scripts need it.

## Conventions

- Reports are Chinese text on stdout; the exit code is the machine signal:
  `0` success, `1` the operation ran and failed, `2` usage error. Some report
  strings still say `obsidian-devkit`; the command is always the local entry
  above.
- Relative paths are resolved against `--cwd` (default: the current directory).
- `deploy` and `status` never open or focus Obsidian; `reload` never
  cold-starts it. Window-level CLI commands act on the **frontmost** vault.
- Nothing here runs a watcher or an e2e suite.

## Commands

```
node scripts/devkit.mjs scaffold <targetDir> --id <id> --name <name> [flags]
node scripts/devkit.mjs build <projectDir> [flags]
node scripts/devkit.mjs validate <projectDir>
node scripts/devkit.mjs version <projectDir> <semver> [--min-app-version <semver>]
node scripts/devkit.mjs deploy <projectDir> [flags]
node scripts/devkit.mjs status [projectDir] [flags]
node scripts/devkit.mjs reload [projectDir] [flags]
node scripts/devkit.mjs test <projectDir> [flags]
node scripts/devkit.mjs e2e <projectDir> [--action init|status] [--overwrite]
```

### scaffold

Creates the project from the official template set and validates the naming
rules before writing anything.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--description <text>` | `<Name> — an Obsidian plugin.` | manifest description (<= 250 chars, ends with `.`) |
| `--author <name>` | `Unknown` | manifest author |
| `--author-url <url>` | none | optional author URL |
| `--plugin-version <semver>` | `0.1.0` | initial manifest/package version |
| `--min-app-version <semver>` | `1.13.0` | manifest `minAppVersion` (1.13.0+ enables declarative settings) |
| `--desktop-only` | off | set `isDesktopOnly: true` |
| `--settings-style auto\|declarative\|legacy` | `auto` | settings API generation |
| `--package-manager pnpm\|npm\|yarn\|bun` | `pnpm` | README/AGENTS instructions only |
| `--overwrite` | off | allow writing into a non-empty directory |

### build

One-shot build (`tsc` + esbuild via the project's own `build` script, otherwise
the local esbuild binary), then static checks: artifact presence, CommonJS
shape, manifest/package/versions consistency, settings version gate.

`--development` (off by default; development bundles are reported as not
deployable), `--entry <file>`, `--out-dir <dir>`, `--timeout <ms>` (300000).

### validate

Read-only pre-delivery audit: naming, manifest constraints, semver, version
sync across the three files, TypeScript entry, CommonJS bundle, settings gate,
release checklist. Run after every build and before tagging.

### version

Rewrites `manifest.json` (source of truth), `package.json` and `versions.json`
and reports every changed file. `--min-app-version <semver>` also updates
`minAppVersion`. Non-semver input exits 1.

### deploy

Copies `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/<id>/`, merges the id into `community-plugins.json`
(never replaces other entries) and records the deployment in
`<vault>/.dsh/devkit.json`. Works with Obsidian closed.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--vault <name\|path>` | workspace dev vault | registered vault name, vault path, or folder path |
| `--plugin-id <id>` | manifest id | must match the manifest when given |
| `--no-enable` | off (enable=true) | do not add the id to `community-plugins.json` |
| `--no-create-vault` | off | do not create the workspace dev vault |
| `--dry-run` | off | print the writes without touching anything |
| `--test-vault <dir>` | `dev-vault` | workspace-relative dev vault name |
| `--no-probe` | off | skip the read-only live-app probe (always reports `unknown` then) |
| `--obsidian-cli <command>` | env `OBSIDIAN_CLI` or `obsidian` | CLI executable for the probe |

### status

Read-only environment audit: Obsidian running/CLI version, registered vaults,
project build state/dependencies, deployments across vaults, deploy drift, and
what the running app actually sees. Every section degrades to `unknown` with a
reason. `--vault`, `--test-vault`, `--obsidian-cli` as above.

### reload

Drives a running Obsidian through the **official Obsidian CLI** (Obsidian >=
1.12.4, CLI enabled in Settings -> General). `--action reload|rescan|enable|disable`
(default `reload`), `--plugin-id`, `--vault`, `--timeout <ms>` (30000),
`--obsidian-cli`. Exit 0 does not prove success: the CLI prints `Error:` and
still exits 0, so the command also performs a read-only verification query.

### test

L2 isolated smoke: executes the built `main.js` in a Node VM with stubbed
`obsidian`/`electron`/CodeMirror modules. `--bundle <path>` overrides the
artifact, `--scenario load|onload|unload` (default `load`), `--timeout <ms>`
(15000). A pass proves the bundle loads against stubs — not real-API
compatibility.

### e2e

Writes or audits a sandboxed `wdio-obsidian-service` harness: `wdio.conf.mts`,
a generated spec (auto-detects the plugin's command ids), a fixture vault,
`e2e/tsconfig.json`, `e2e/README.md`, merged devDependencies and a `test:e2e`
script. `--action init|status` (default `init`), `--overwrite`. It never runs
the suite: the first run downloads Obsidian (hundreds of MB) and opens a
sandboxed window, which is a human/CI decision.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `OBSIDIAN_CLI` | path/command of the Obsidian CLI wrapper (default `obsidian`) |
| `--cwd <dir>` | base directory for relative paths (global flag) |

`install-skill` is not part of the skill workflow: install by copying the folder,
and the runtime travels inside it. The compiled `lib/commandline.js` may still
accept the legacy subcommand for older devkit users; do not rely on it.

## If the scripts cannot run

If Node.js < 20 or the `scripts/` folder is missing, do the steps by hand and
say which verification layer you could not run:

- Scaffold/build: copy the template files from the repository's
  `assets/templates/` and run `pnpm install` + the project's `build` script.
- Validate: follow `reference/submission.md` and check manifest fields,
  CommonJS output, trio version sync and the settings gate manually.
- Deploy: copy the three files into `<vault>/.obsidian/plugins/<id>/` and add
  the id to `community-plugins.json` without replacing other entries.
- Smoke/e2e: report them as not run. Never claim a layer you did not execute.
