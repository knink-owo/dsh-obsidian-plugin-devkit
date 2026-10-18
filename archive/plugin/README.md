# Archived: the DSH plugin bundle (v0.5.0)

This folder keeps the code of the original delivery form: a DeepSeek Harness
(Cordis) host bundle that registered nine `obsidian_devkit_*` tools, a bundled
`obsidian-plugin-dev` skill and a session-context injection.

It was archived in v1.0.0. Rationale: the host plugin required a profile
install, a host-module reload after every change, and coupled the toolkit to the
host API — while almost all of the logic is plain Node. The same capability now
ships as:

- `obsidian-devkit` CLI (the supported interface), and
- the `skill/obsidian-plugin-dev` skill (installed with
  `obsidian-devkit install-skill`).

The plugin form is preserved for reference and for anyone who wants to reuse
the Cordis wiring:

| File | Purpose |
| --- | --- |
| `src/index.ts` | bundle entry: `apply()` registers the nine tools, skill and context |
| `src/skill.ts` | host-side skill registration (`ctx.get("skills")`) |
| `src/context.ts` | host-side session context injection (`systemPrompt`) |
| `cordis.patch.yml` | loader patch for the DSH profile |
| `locale/en.json`, `locale/zh.json` | display metadata (title/description) |
| `icon.svg` | display icon |
| `assets/docs/harness.default.md` | injected session context text (Chinese) |

Archived at git tag `archive-plugin-v0.5.0` (last commit `129e553`). The files
do not compile as part of the current package (`tsconfig.json` includes only
`src/`) and their relative imports assume the old layout; treat them as
reference material, not as a maintained module.
