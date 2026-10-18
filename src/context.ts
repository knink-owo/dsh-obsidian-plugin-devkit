/**
 * Session context injection.
 *
 * Registers one optional `systemPrompt` context entry describing the Obsidian
 * plugin development capabilities of this bundle. The text lives in
 * `assets/docs/harness.default.md` so it can change without touching code; a
 * compiled-in fallback keeps the plugin working if the asset is missing.
 *
 * Prompt-context registration is strictly best-effort: hosts without the
 * service (or with a read-only prompt) keep working with tools alone.
 */
import { readAsset } from "./fs.js";
import type { DevkitContext } from "./types.js";

export interface PromptContextLike {
  name: string;
  order: number;
  text: string;
  interpolate?: boolean;
  required?: boolean;
}

export interface SystemPromptServiceLike {
  context?(entry: PromptContextLike): void | (() => void);
  section?(section: PromptContextLike): void | (() => void);
}

/** Placement used for this bundle's context block (finite number is required). */
export const CONTEXT_ORDER = 250;

/** Asset path relative to the built `lib/` folder. */
const CONTEXT_ASSET = "../assets/docs/harness.default.md";

export const FALLBACK_CONTEXT_TEXT = [
  "# Obsidian plugin development",
  "",
  "This session can develop Obsidian community plugins with the obsidian_devkit_* tools.",
  "Load the `obsidian-plugin-dev` skill before starting; it carries the official rules",
  "and the layered verification loop. Verify in layers (static, isolated smoke, real",
  "vault, human check) and report unknown when the app cannot be observed. Never",
  "cold-start Obsidian, steal focus, or enable/disable a user's plugins unasked.",
].join("\n");

export interface ContextRegistrationResult {
  registered: boolean;
  reason?: string;
  order?: number;
}

/** Read the injected context text (asset first, compiled-in fallback second). */
export function contextText(): string {
  try {
    const text = readAsset(CONTEXT_ASSET).replace(/^\uFEFF/, "").trim();
    return text.length > 0 ? text : FALLBACK_CONTEXT_TEXT;
  } catch {
    return FALLBACK_CONTEXT_TEXT;
  }
}

/**
 * Register the context entry into the optional `systemPrompt` service.
 * `context()` (dynamic runtime context) is preferred over `section()` because
 * it is refreshable; both are tried when present.
 */
export function registerDevContext(
  ctx: DevkitContext,
  options?: { text?: string; order?: number },
): ContextRegistrationResult {
  const service = ctx.get?.("systemPrompt") as SystemPromptServiceLike | undefined;
  if (service === undefined || service === null) {
    return { registered: false, reason: "systemPrompt service unavailable" };
  }
  const entry: PromptContextLike = {
    name: "obsidian-plugin-devkit",
    order: options?.order ?? CONTEXT_ORDER,
    text: options?.text ?? contextText(),
  };
  if (!Number.isFinite(entry.order)) {
    return { registered: false, reason: "invalid order" };
  }
  try {
    if (typeof service.context === "function") {
      service.context(entry);
      return { registered: true, order: entry.order };
    }
    if (typeof service.section === "function") {
      service.section(entry);
      return { registered: true, order: entry.order };
    }
    return { registered: false, reason: "no context or section method" };
  } catch (error) {
    ctx.logger?.warn?.(
      `obsidian-plugin-devkit: context registration failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { registered: false, reason: "registration threw" };
  }
}
