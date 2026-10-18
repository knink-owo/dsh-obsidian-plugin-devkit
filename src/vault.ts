/**
 * Obsidian vault discovery and safety checks.
 *
 * The CLI and the deploy tool both need "a real vault": a directory containing
 * `.obsidian/`. Deploy is a write operation, so the resolution rules are
 * deliberately strict:
 *
 *  - an explicit `vault` argument must point at an existing vault (or resolve
 *    through the Obsidian vault registry by name);
 *  - only the *default* development vault may be created inside the workspace,
 *    and only when the caller asked for it;
 *  - nothing is ever guessed from the process cwd: the harness resolves relative
 *    paths against its own cwd, which is not the session workspace.
 */
import { basename } from "node:path";

import type { Fs } from "./fs.js";
import { joinPath } from "./manifest.js";
import type { FsCall } from "./types.js";

export interface VaultEntry {
  /** Opaque vault id from Obsidian's registry. */
  id: string;
  /** Folder name, which is how the CLI addresses a vault (`vault=<name>`). */
  name: string;
  path: string;
  open: boolean;
}

export interface VaultRegistry {
  path: string | null;
  entries: VaultEntry[];
  error: string | null;
}

/** Location of Obsidian's per-user configuration directory. */
export function obsidianConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform === "win32") {
    return typeof env.APPDATA === "string" && env.APPDATA.length > 0
      ? joinPath(env.APPDATA, "obsidian")
      : null;
  }
  if (platform === "darwin") {
    return typeof env.HOME === "string" && env.HOME.length > 0
      ? joinPath(joinPath(joinPath(env.HOME, "Library"), "Application Support"), "obsidian")
      : null;
  }
  if (typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.length > 0) {
    return joinPath(env.XDG_CONFIG_HOME, "obsidian");
  }
  return typeof env.HOME === "string" && env.HOME.length > 0
    ? joinPath(joinPath(env.HOME, ".config"), "obsidian")
    : null;
}

/** Parse `obsidian.json`. Unknown shapes degrade to an empty registry. */
export function parseVaultRegistry(text: string): VaultEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const vaults = (parsed as { vaults?: unknown }).vaults;
  if (typeof vaults !== "object" || vaults === null) return [];
  const entries: VaultEntry[] = [];
  for (const [id, value] of Object.entries(vaults)) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as { path?: unknown; open?: unknown };
    if (typeof record.path !== "string" || record.path.length === 0) continue;
    entries.push({
      id,
      name: basename(record.path),
      path: record.path,
      open: record.open === true,
    });
  }
  return entries;
}

/** Read the vault registry from Obsidian's config directory. */
export async function readVaultRegistry(fs: Fs, call: FsCall): Promise<VaultRegistry> {
  const dir = obsidianConfigDir();
  if (dir === null) {
    return { path: null, entries: [], error: "无法定位 Obsidian 配置目录（APPDATA/HOME 未设置）。" };
  }
  const path = joinPath(dir, "obsidian.json");
  try {
    const text = await fs.readText(path);
    return { path, entries: parseVaultRegistry(text), error: null };
  } catch (error) {
    return {
      path,
      entries: [],
      error: `未能读取 ${path}：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export interface VaultResolution {
  path: string;
  source: "registry" | "explicit" | "default";
  entry: VaultEntry | null;
  exists: boolean;
  isVault: boolean;
  /** The directory has to be created on deploy (only possible for the default vault). */
  createOnDeploy: boolean;
  problem: string | null;
  warning: string | null;
  registryPath: string | null;
  registryError: string | null;
}

export interface ResolveVaultOptions {
  vault?: string;
  workspaceRoot?: string;
  /** Workspace-relative development vault used when no explicit vault is given. */
  defaultVault: string;
  /** Whether the default development vault may be created (never an external path). */
  create: boolean;
  /** Injection seam for tests. */
  registry?: VaultRegistry;
  platform?: NodeJS.Platform;
}

function normalizePathForCompare(path: string, platform: NodeJS.Platform): string {
  const slashed = path.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  return platform === "win32" ? slashed.toLowerCase() : slashed;
}

/**
 * Resolve which vault a live operation targets and decide whether it is safe.
 * Returns a problem instead of throwing so the tool can render a user-facing
 * explanation.
 */
export async function resolveVault(
  fs: Fs,
  options: ResolveVaultOptions,
  call: FsCall,
): Promise<VaultResolution> {
  const platform = options.platform ?? process.platform;
  const workspaceRoot = options.workspaceRoot ?? call.workspaceRoot;
  const registry = options.registry ?? (await readVaultRegistry(fs, call));
  const normalize = (value: string): string => normalizePathForCompare(value, platform);
  const explicit = options.vault?.trim();
  const explicitTarget = explicit !== undefined && explicit.length > 0 ? explicit : undefined;

  let path: string;
  let source: VaultResolution["source"];
  let entry: VaultEntry | null = null;

  if (explicitTarget !== undefined) {
    entry =
      registry.entries.find((candidate) => candidate.id === explicitTarget) ??
      registry.entries.find((candidate) => candidate.name === explicitTarget) ??
      registry.entries.find((candidate) => normalize(candidate.path) === normalize(explicitTarget)) ??
      registry.entries.find(
        (candidate) => normalize(candidate.path) === normalize(joinPath(workspaceRoot ?? "", explicitTarget)),
      ) ??
      null;
    if (entry !== null) {
      path = entry.path;
      source = "registry";
    } else {
      path = await fs.resolve(explicitTarget, workspaceRoot);
      source = "explicit";
    }
  } else {
    path = await fs.resolve(options.defaultVault, workspaceRoot);
    source = "default";
    entry =
      registry.entries.find((candidate) => normalize(candidate.path) === normalize(path)) ?? null;
  }

  const exists = await fs.isDirectory(path, call.workspaceRoot);
  const isVault = exists && (await fs.isDirectory(joinPath(path, ".obsidian"), call.workspaceRoot));
  let problem: string | null = null;
  let warning: string | null = null;
  let createOnDeploy = false;

  const workspaceHint = workspaceRoot ?? "(会话工作区未知)";
  if (!exists) {
    if (source === "default" && options.create) {
      createOnDeploy = true;
    } else if (source === "default") {
      problem = `开发 vault 不存在：${path}（位于工作区 ${workspaceHint}；create=false 已阻止创建）。`;
    } else {
      problem = `目标 vault 不存在：${path}。请指向已有 vault，或省略 vault 参数让工具使用工作区内的 ${options.defaultVault} 开发 vault。`;
    }
  } else if (!isVault) {
    if (source === "default" && options.create) {
      createOnDeploy = true;
      warning = `${path} 目录已存在但不是 Obsidian vault；deploy 会补建 .obsidian/ 结构（以开发 vault 身份使用）。`;
    } else {
      problem = `${path} 不是 Obsidian vault（缺少 .obsidian 目录）。Vault 参数必须指向真实 vault。`;
    }
  }

  if (source === "explicit" && registry.error !== null) {
    warning = warning === null ? `无法读取 vault 注册表（${registry.error}）；已按要求当作路径处理。` : warning;
  }

  return {
    path,
    source,
    entry,
    exists,
    isVault,
    createOnDeploy,
    problem,
    warning,
    registryPath: registry.path,
    registryError: registry.error,
  };
}

/** Folder name Obsidian uses in the window title; the CLI's vault selector. */
export function vaultName(path: string): string {
  return basename(path);
}
