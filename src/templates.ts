/**
 * Project templates.
 *
 * A scaffolded project follows the official sample-plugin architecture:
 * TypeScript sources under `src/`, an esbuild config that bundles to CommonJS
 * `main.js`, `manifest.json`/`versions.json` for Obsidian, and a `version-bump`
 * script so npm's `version` lifecycle keeps the three version fields in sync.
 *
 * Two settings flavours are available:
 *  - `declarative`: Obsidian 1.13.0+ renders `getSettingDefinitions()` itself;
 *  - `legacy`: the classic `display()` + `new Setting(...)` tab, required when
 *    `minAppVersion` is below 1.13.0.
 *
 * Template syntax: `{{VAR}}` substitution, `{{VAR|JSON}}` JSON-escaped
 * substitution (for values inside JSON files), and block conditionals:
 *   {{#IF_AUTHOR_URL}}
 *   ...only when AUTHOR_URL is non-empty...
 *   {{/IF_AUTHOR_URL}}
 */
import { readAsset } from "./fs.js";
import { toClassName } from "./naming.js";

export type SettingsStyle = "declarative" | "legacy";

export interface ScaffoldVars {
  id: string;
  name: string;
  description: string;
  author: string;
  authorUrl?: string;
  version: string;
  minAppVersion: string;
  desktopOnly: boolean;
  packageManager: string;
  year: number;
}

export type TemplateVar = string | boolean | undefined;

export function buildVars(input: ScaffoldVars): Record<string, string> {
  return {
    PLUGIN_ID: input.id,
    PLUGIN_NAME: input.name,
    PLUGIN_CLASS: toClassName(input.name),
    PLUGIN_DESCRIPTION: input.description,
    PLUGIN_AUTHOR: input.author,
    AUTHOR_URL: input.authorUrl ?? "",
    PLUGIN_VERSION: input.version,
    MIN_APP_VERSION: input.minAppVersion,
    IS_DESKTOP_ONLY: input.desktopOnly ? "true" : "false",
    PACKAGE_MANAGER: input.packageManager,
    YEAR: String(input.year),
  };
}

const CONDITIONAL_RE =
  /\{\{#IF_([A-Z0-9_]+)\}\}(?:\r?\n)?([\s\S]*?)(?:\r?\n)?\{\{\/IF_\1\}\}(?:\r?\n)?/g;
const VARIABLE_RE = /\{\{([A-Z0-9_]+)(\|JSON)?\}\}/g;

export function renderTemplate(
  text: string,
  vars: Record<string, TemplateVar>,
): string {
  const withoutConditionals = text.replace(
    CONDITIONAL_RE,
    (_match, name: string, inner: string) => {
      const value = vars[name];
      return value === true || (typeof value === "string" && value.length > 0) ? inner : "";
    },
  );
  return withoutConditionals.replace(
    VARIABLE_RE,
    (_match, name: string, filter: string | undefined) => {
      const value = vars[name];
      if (value === undefined) {
        throw new Error(`Unknown template variable: ${name}`);
      }
      if (filter === "|JSON") {
        return JSON.stringify(value).slice(1, -1);
      }
      return String(value);
    },
  );
}

export interface TemplateFile {
  source: string;
  dest: string;
}

export function templateFiles(style: SettingsStyle): TemplateFile[] {
  const files: TemplateFile[] = [
    { source: "manifest.json", dest: "manifest.json" },
    { source: "package.json", dest: "package.json" },
    { source: "tsconfig.json", dest: "tsconfig.json" },
    { source: "esbuild.config.mjs", dest: "esbuild.config.mjs" },
    { source: "version-bump.mjs", dest: "version-bump.mjs" },
    { source: "versions.json", dest: "versions.json" },
    { source: "eslint.config.mts", dest: "eslint.config.mts" },
    { source: "styles.css", dest: "styles.css" },
    { source: "gitignore", dest: ".gitignore" },
    { source: "LICENSE", dest: "LICENSE" },
    { source: "README.md", dest: "README.md" },
    { source: "AGENTS.md", dest: "AGENTS.md" },
    { source: "src/main.ts", dest: "src/main.ts" },
    {
      source: style === "declarative" ? "src/settings.declarative.ts" : "src/settings.legacy.ts",
      dest: "src/settings.ts",
    },
  ];
  return files;
}

const JSON_DESTS = new Set(["manifest.json", "package.json", "tsconfig.json", "versions.json"]);

export interface RenderedFile {
  dest: string;
  content: string;
}

/** Read, substitute and validate every template for one scaffold. */
export function renderScaffoldFiles(
  vars: Record<string, string>,
  style: SettingsStyle,
): RenderedFile[] {
  const rendered = templateFiles(style).map((file) => ({
    dest: file.dest,
    content: renderTemplate(readAsset(`../assets/templates/${file.source}`), vars),
  }));
  for (const file of rendered) {
    if (JSON_DESTS.has(file.dest)) {
      try {
        JSON.parse(file.content);
      } catch (error) {
        throw new Error(
          `Template ${file.dest} rendered to invalid JSON (${error instanceof Error ? error.message : String(error)}).`,
        );
      }
    }
  }
  return rendered;
}
