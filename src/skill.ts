/**
 * Bundled development-guideline skill.
 *
 * The skill is a plain Markdown file plus a `reference/` directory shipped in
 * `assets/skills/obsidian-plugin-dev`. It is registered into the host's
 * optional `skills` registry at apply time; when that service is absent the
 * plugin still works (tools only) and registration is skipped silently.
 */
import { fileURLToPath } from "node:url";
import { readAsset } from "./fs.js";
import type { DevkitContext } from "./types.js";

/** Skills service surface used here (all optional: see `DevkitContext.get`). */
export interface SkillRegistrationLike {
  name: string;
  description: string;
  whenToUse?: string;
  content: string;
  source?: string;
  resourceBase?: { kind: "directory"; path: string } | { kind: string; [key: string]: unknown };
  metadata?: Record<string, unknown>;
}

export interface SkillsServiceLike {
  register?(skill: SkillRegistrationLike): void | (() => void);
}

export interface ParsedSkill {
  frontmatter: Record<string, string>;
  body: string;
}

const SKILL_DIR = "../assets/skills/obsidian-plugin-dev";

/** Files that must exist next to SKILL.md, surfaced for tests and self-checks. */
export const REFERENCE_FILES = [
  "reference/submission.md",
  "reference/settings.md",
  "reference/lifecycle.md",
  "reference/verification.md",
  "reference/debugging.md",
] as const;

/**
 * Parse the tiny YAML frontmatter subset a skill uses: `key: value` pairs
 * between the first two `---` fences. Unknown nested content is ignored
 * (frontmatter metadata is descriptive only).
 */
export function parseSkillFrontmatter(text: string): ParsedSkill {
  const normalized = text.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(normalized);
  if (match === null) return { frontmatter: {}, body: normalized };
  const frontmatter: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const pair = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (pair === null) continue;
    const key = pair[1] as string;
    let value = (pair[2] as string).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) frontmatter[key] = value;
  }
  return { frontmatter, body: (match[2] ?? "").replace(/^\r?\n/, "") };
}

/** Resolve the absolute directory that owns SKILL.md (next to the built lib/). */
export function skillDirectory(): string {
  return fileURLToPath(new URL(SKILL_DIR, import.meta.url));
}

/**
 * Build the registration object from the bundled SKILL.md text. Kept pure so
 * tests can feed arbitrary text without touching the filesystem.
 */
export function skillFromText(text: string, directory?: string): SkillRegistrationLike {
  const { frontmatter, body } = parseSkillFrontmatter(text);
  const name = frontmatter["name"] ?? "obsidian-plugin-dev";
  const description =
    frontmatter["description"] ??
    "Develop, build, deploy and validate an Obsidian community plugin with the official rules and layered verification.";
  const metadata: Record<string, unknown> = {};
  if (frontmatter["license"] !== undefined) metadata["license"] = frontmatter["license"];
  if (frontmatter["version"] !== undefined) metadata["version"] = frontmatter["version"];
  const registration: SkillRegistrationLike = {
    name,
    description,
    content: body,
    source: "runtime",
    resourceBase: { kind: "directory", path: directory ?? skillDirectory() },
  };
  const whenToUse = frontmatter["whenToUse"] ?? frontmatter["when_to_use"];
  if (whenToUse !== undefined) registration.whenToUse = whenToUse;
  if (Object.keys(metadata).length > 0) registration.metadata = metadata;
  return registration;
}

/** Read and parse the bundled skill. Throws when the asset is missing. */
export function bundledSkill(directory?: string): SkillRegistrationLike {
  const dir = directory ?? skillDirectory();
  return skillFromText(readAsset(`${SKILL_DIR}/SKILL.md`), dir);
}

export interface SkillRegistrationResult {
  registered: boolean;
  reason?: string;
  name?: string;
}

/**
 * Register the bundled skill into the optional `skills` registry. Missing
 * service or missing `register` is not an error: the plugin keeps its tools.
 */
export function registerSkill(
  ctx: DevkitContext,
  options?: { directory?: string; registration?: SkillRegistrationLike },
): SkillRegistrationResult {
  const service = ctx.get?.("skills") as SkillsServiceLike | undefined;
  if (service === undefined || service === null || typeof service.register !== "function") {
    return { registered: false, reason: "skills service unavailable" };
  }
  try {
    const registration = options?.registration ?? bundledSkill(options?.directory);
    service.register(registration);
    return { registered: true, name: registration.name };
  } catch (error) {
    ctx.logger?.warn?.(
      `obsidian-plugin-devkit: skill registration failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { registered: false, reason: "registration threw" };
  }
}
