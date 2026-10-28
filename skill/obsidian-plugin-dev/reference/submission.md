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

1. Bump the version (`node scripts/devkit.mjs version <dir> <semver>`), commit
   `manifest.json`, `package.json` and `versions.json` together.
2. Create a GitHub release whose **tag equals the manifest version** exactly —
   `1.2.0`, not `v1.2.0` and not `1.2.0-beta.1`. Note that `pnpm version` and
   `npm version` create a `v`-prefixed tag by default; tag by hand or strip the
   prefix before pushing.
3. Attach exactly three assets: `main.js`, `manifest.json`, `styles.css` (the
   last one only if the plugin ships styles). Obsidian only ever downloads
   these files; no zip.
4. Tags can drive the whole release from CI. A working workflow does:
   `pnpm install --frozen-lockfile` -> `pnpm run build` -> `pnpm run lint` ->
   fail unless the pushed tag equals `manifest.json` version -> create/update the
   release with `softprops/action-gh-release` and attach the three files.
5. **Verify the release, not the Actions tab.** The run list can lag and even
   show a stale `queued` run while the release already exists. Download and
   compare hashes instead:

   ```bash
   gh release download <version> -D /tmp/release-check
   sha256sum main.js /tmp/release-check/main.js
   ```

## Submit through community.obsidian.md (not a PR)

There is **no pull request to `obsidianmd/obsidian-releases` anymore**.
`community-plugins.json` in that repository is regenerated hourly from
`https://community.obsidian.md/assets/community-plugins.json` by its
`mirror-community-json.yml` workflow, so manual entries are overwritten.
Submissions happen on the directory website:

1. Sign in at <https://community.obsidian.md> with an Obsidian account. (The
   GitHub account alone is not enough — a human signs in; an agent cannot do
   this step for the user.)
2. Link the GitHub account that owns the repository; the directory uses it to
   verify ownership.
3. Choose **Add plugin**, point at the repository URL, confirm the description.
   The directory reads `manifest.json` at the HEAD of the default branch.
4. Review is automated. Address what it reports, bump the version, publish a new
   GitHub release; the directory picks new releases up on its own. Only the
   first submission is manual.

Before submitting, at minimum: `manifest.json`, `README.md` and `LICENSE` at the
repository root; a release whose tag equals the manifest version with the three
assets; a truthful `minAppVersion`; no `fundingUrl` unless donations are
accepted; description punctuation and length inside the limits. The review
enforces the [submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
and the [developer policies](https://docs.obsidian.md/Developer+policies).

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
  run `node scripts/devkit.mjs validate <dir>` before tagging.
- `main.js` must be CommonJS. If the build emits an ES module, Obsidian fails
  to load it with a `module is not defined`-style error.
- `styles.css` referenced but missing (or the reverse) breaks the store listing.
- Settings that use the 1.13+ declarative API must not also crash on older
  `minAppVersion`; either raise `minAppVersion` or ship a legacy fallback.
