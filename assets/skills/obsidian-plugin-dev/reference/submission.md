# Submission and release rules

Source of truth: the official Obsidian developer docs (community directory ->
submission requirements) and the community site review pipeline. Publishing is
now handled by `community.obsidian.md`; the old `obsidian-releases` PR
validator is gone. Review is automated — the rules below are enforced, not
suggested.

## Naming

- **id**: lowercase letters, digits, `_` and `-`, no spaces. Must not contain
  `obsidian`, must not end with `plugin`. It is the install folder name and is
  permanent. `community-plugins.json` in every vault uses it.
- **name**: Basic Latin only, no emoji, must not contain `Obsidian`, must not
  end with `Plugin`, must not shadow a core plugin name.
- **description**: at most 250 characters, no emoji, must end with `.`, `!` or
  `?`, must not mention Obsidian or say "This plugin".
- **author / authorUrl**: the author must be the repository owner; the GitHub
  user in `authorUrl` is what review checks.
- **fundingUrl**: donation links only (Buy Me a Coffee, GitHub Sponsors, ...).

## manifest.json

Required and validated: `id`, `name`, `version`, `minAppVersion`,
`description`, `author`, `isDesktopOnly`. `version` is plain `x.y.z` (no
prerelease tags), and must match `package.json` and the top of `versions.json`.
`minAppVersion` must be truthful: the plugin must run on that version.

`versions.json` maps each released version to its `minAppVersion`; it is
appended, never rewritten.

## Release

1. Bump the version (`obsidian_devkit_version`), commit `manifest.json`,
   `package.json` and `versions.json` together.
2. Create a GitHub release whose **tag equals the manifest version** exactly —
   `1.2.0`, not `v1.2.0` and not `1.2.0-beta.1`.
3. Attach exactly three assets: `main.js`, `manifest.json`, `styles.css` (the
   last one only if the plugin ships styles). Obsidian only ever downloads
   these files; no zip.
4. The official GitHub Actions workflow can do build + release on tag push.

## Developer policies (review blockers)

- No obfuscated code and no minified-only sources: the repository must contain
  the readable source the release was built from.
- No ads, no donation prompts inside the UI beyond the manifest links.
- No client-side telemetry without explicit opt-in; no self-update machinery;
  no downloading and executing remote code.
- Only access the network for functionality the description documents.
- Do not modify the user's vault in ways the plugin does not announce.

## Review gotchas seen in practice

- Description punctuation and length are the most common mechanical rejections;
  run `obsidian_devkit_validate` before tagging.
- `main.js` must be CommonJS. If the build emits an ES module, Obsidian fails
  to load it with a `module is not defined`-style error.
- `styles.css` referenced but missing (or the reverse) breaks the store listing.
- Settings that use the 1.13+ declarative API must not also crash on older
  `minAppVersion`; either raise `minAppVersion` or ship a legacy fallback.
