# {{PLUGIN_NAME}}

{{PLUGIN_DESCRIPTION}}

## Development

```bash
{{PACKAGE_MANAGER}} install
{{PACKAGE_MANAGER}} run dev      # watch build to main.js
{{PACKAGE_MANAGER}} run build    # type-check + production bundle
{{PACKAGE_MANAGER}} run lint
```

## Project layout

| Path | Purpose |
| --- | --- |
| `src/main.ts` | Plugin entry point; `default export` extends `Plugin`. |
| `src/settings.ts` | Settings shape, defaults and settings tab. |
| `manifest.json` | Obsidian metadata; `id` must match the install folder name. |
| `versions.json` | Released version → minimum app version map. |
| `main.js` | Generated bundle (do not edit, do not commit). |
| `styles.css` | Optional stylesheet loaded with the plugin. |

## Test it in Obsidian

1. Run `{{PACKAGE_MANAGER}} run build`.
2. Copy `main.js`, `manifest.json` and (if present) `styles.css` into
   `<vault>/.obsidian/plugins/{{PLUGIN_ID}}/`.
3. Enable the plugin in **Settings → Community plugins**, then reload it after
   each build (`Ctrl+P` → *Reload app without saving*, or a hot-reload plugin).

## Release

1. `{{PACKAGE_MANAGER}} version patch|minor|major` — updates `manifest.json`,
   `package.json` and `versions.json` together.
2. `{{PACKAGE_MANAGER}} run build`.
3. Create a GitHub release whose tag equals `manifest.json.version`, attaching
   `main.js`, `manifest.json` and `styles.css`.
4. Submit the repository at <https://community.obsidian.md> (Plugins → New plugin)
   once; later releases are picked up from the GitHub release.

## License

0-BSD — see [LICENSE](LICENSE).
