/**
 * Obsidian plugin naming rules.
 *
 * These encode the community submission requirements that are cheap to check
 * offline. They are deliberately hard rules (reject) only where the community
 * review rejects; softer guidelines (e.g. "do not start with 'This plugin'")
 * are reported as warnings by `namingWarnings`.
 */

const PLUGIN_ID_RE = /^[a-z0-9_-]+$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const BASIC_LATIN_RE = /^[\x20-\x7E]+$/;

export interface PluginNamingInput {
  id?: string;
  name?: string;
  description?: string;
  author?: string;
  version?: string;
  minAppVersion?: string;
}

export function isSemver(value: string): boolean {
  return SEMVER_RE.test(value);
}

/** Reasonable target for `manifest.json.id`, derived from a display name. */
export function toPluginId(name: string): string {
  let id = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (id.length === 0) id = "my-plugin";
  if (id.includes("obsidian")) id = id.replace(/obsidian/g, "vault");
  if (id.endsWith("plugin")) id = `${id}-tools`;
  if (/^[a-z]/.test(id) === false) id = `plugin-${id}`;
  return id;
}

/** PascalCase class name for a plugin display name. */
export function toClassName(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  let className = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  if (className.length === 0) className = "MyPlugin";
  if (/^[A-Za-z]/.test(className) === false) className = `Plugin${className}`;
  return className;
}

export function pluginIdProblems(id: string): string[] {
  const problems: string[] = [];
  if (id.trim().length === 0) {
    problems.push("manifest id is required.");
  } else if (!PLUGIN_ID_RE.test(id)) {
    problems.push(
      `manifest id "${id}" must match /^[a-z0-9_-]+$/ (lowercase letters, digits, underscores and hyphens only).`,
    );
  }
  if (id.toLowerCase().includes("obsidian")) {
    problems.push(`manifest id "${id}" must not contain "obsidian".`);
  }
  if (id.toLowerCase().endsWith("plugin")) {
    problems.push(`manifest id "${id}" must not end with "plugin".`);
  }
  return problems;
}

export function pluginNameProblems(name: string): string[] {
  const problems: string[] = [];
  const lower = name.toLowerCase();
  if (name.trim().length === 0) {
    problems.push("manifest name is required.");
  }
  if (lower.includes("obsidian")) {
    problems.push(`manifest name "${name}" must not contain "Obsidian".`);
  }
  if (lower.startsWith("obsi")) {
    problems.push(`manifest name "${name}" must not start with "Obsi".`);
  }
  if (lower.endsWith("dian")) {
    problems.push(`manifest name "${name}" must not end with "dian".`);
  }
  if (lower.endsWith("plugin")) {
    problems.push(`manifest name "${name}" must not end with "Plugin".`);
  }
  if (EMOJI_RE.test(name)) {
    problems.push(`manifest name "${name}" must not contain emojis.`);
  }
  if (!BASIC_LATIN_RE.test(name)) {
    problems.push(
      `manifest name "${name}" must use basic latin characters only (no full-width or CJK punctuation).`,
    );
  }
  return problems;
}

export function descriptionProblems(description: string): string[] {
  const problems: string[] = [];
  if (description.trim().length === 0) {
    problems.push("manifest description is required.");
    return problems;
  }
  if (description.length > 250) {
    problems.push(
      `manifest description is ${description.length} characters; the community directory limit is 250.`,
    );
  }
  if (!/[.!?…。！？]$/.test(description.trim())) {
    problems.push(
      'manifest description must end with a sentence-ending punctuation mark (".", "!" or "?").',
    );
  }
  if (EMOJI_RE.test(description)) {
    problems.push("manifest description must not contain emojis.");
  }
  return problems;
}

/** Soft guidelines from the submission review; not blocking. */
export function namingWarnings(input: PluginNamingInput): string[] {
  const warnings: string[] = [];
  const description = input.description?.trim() ?? "";
  if (/^this plugin\b/i.test(description)) {
    warnings.push('Description starts with "This plugin" — prefer an action-first phrasing.');
  }
  if (/obsidian/i.test(description)) {
    warnings.push(
      'Description mentions "Obsidian"; the directory already implies it. Prefer describing what the plugin does instead.',
    );
  }
  if (input.author !== undefined && input.author.trim().length === 0) {
    warnings.push("manifest author should be a real name or handle; it is shown in the directory.");
  }
  if (input.version !== undefined && /^v/i.test(input.version)) {
    warnings.push('Version must be bare semver ("1.0.0", not "v1.0.0").');
  }
  return warnings;
}

/** Every hard naming problem for the metadata accepted by `obsidian_devkit_scaffold`. */
export function namingProblems(input: PluginNamingInput): string[] {
  const problems: string[] = [];
  if (input.id === undefined) problems.push("manifest id is required.");
  else problems.push(...pluginIdProblems(input.id));
  if (input.name === undefined) problems.push("manifest name is required.");
  else problems.push(...pluginNameProblems(input.name));
  if (input.description !== undefined) problems.push(...descriptionProblems(input.description));
  if (input.author !== undefined && input.author.trim().length === 0) {
    problems.push("manifest author is required.");
  }
  if (input.version !== undefined && !isSemver(input.version)) {
    problems.push(`version "${input.version}" must be valid semver, e.g. 1.0.0.`);
  }
  if (input.minAppVersion !== undefined && !isSemver(input.minAppVersion)) {
    problems.push(`minAppVersion "${input.minAppVersion}" must be valid semver, e.g. 1.13.0.`);
  }
  return problems;
}

/** Compare two semver strings; returns -1, 0 or 1 (pre-release ignored). */
export function compareSemver(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value.split("-")[0]!.split(".").map((part) => Number(part));
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
