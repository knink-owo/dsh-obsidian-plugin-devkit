/**
 * Project scaffolding.
 *
 * Writes a complete, buildable Obsidian plugin project: manifest, npm/esbuild
 * toolchain, TypeScript sources with a working command/ribbon/modal/settings tab,
 * lint config and an AGENTS.md that tells coding agents the project's hard rules.
 *
 * Refuses to write into a non-empty directory unless `overwrite` is true, so a
 * misplaced path can never clobber an existing project.
 */
import type { Fs } from "./fs.js";
import { inspectProject, joinPath } from "./manifest.js";
import { compareSemver, namingProblems } from "./naming.js";
import { formatReport, verdict } from "./report.js";
import { buildVars, renderScaffoldFiles, type SettingsStyle } from "./templates.js";
import type { FsCall } from "./types.js";

export interface ScaffoldOptions {
  targetDir: string;
  id: string;
  name: string;
  description: string;
  author: string;
  authorUrl?: string;
  version: string;
  minAppVersion: string;
  desktopOnly: boolean;
  settingsStyle: "auto" | SettingsStyle;
  overwrite: boolean;
  packageManager: string;
}

export interface ScaffoldResult {
  ok: boolean;
  targetDir: string;
  absoluteDir: string;
  style: SettingsStyle;
  files: string[];
  report: string;
}

function resolveStyle(
  requested: ScaffoldOptions["settingsStyle"],
  minAppVersion: string,
): SettingsStyle {
  if (requested !== "auto") return requested;
  return compareSemver(minAppVersion, "1.13.0") >= 0 ? "declarative" : "legacy";
}

export async function scaffold(
  fs: Fs,
  options: ScaffoldOptions,
  call: FsCall,
): Promise<ScaffoldResult> {
  const problems = namingProblems({
    id: options.id,
    name: options.name,
    description: options.description,
    author: options.author,
    version: options.version,
    minAppVersion: options.minAppVersion,
  });
  const style = resolveStyle(options.settingsStyle, options.minAppVersion);
  if (
    style === "declarative" &&
    compareSemver(options.minAppVersion, "1.13.0") < 0
  ) {
    problems.push(
      `Declarative settings require minAppVersion >= 1.13.0; use settingsStyle "legacy" or raise minAppVersion (currently ${options.minAppVersion}).`,
    );
  }

  const absoluteDir = await fs.resolve(options.targetDir, call.workspaceRoot);
  const result: ScaffoldResult = {
    ok: false,
    targetDir: options.targetDir,
    absoluteDir,
    style,
    files: [],
    report: "",
  };

  if (problems.length > 0) {
    result.report = formatReport({
      title: `Scaffold ${options.name || options.targetDir}`,
      summary: verdict(problems, [], "未写入任何文件。"),
      problems,
      nextSteps: ["修正上面的元数据后重新调用 obsidian_devkit_scaffold。"],
    });
    return result;
  }

  if (await fs.exists(options.targetDir, call.workspaceRoot)) {
    if (!(await fs.isDirectory(options.targetDir, call.workspaceRoot))) {
      result.report = formatReport({
        title: `Scaffold ${options.name}`,
        summary: verdict([`Target path exists and is not a directory: ${options.targetDir}`], []),
        problems: [`Target path exists and is not a directory: ${options.targetDir}`],
      });
      return result;
    }
    const entries = await fs.listDir(options.targetDir, call.workspaceRoot);
    if (entries.length > 0 && !options.overwrite) {
      const problem = `Target directory is not empty (${entries.length} entries): ${options.targetDir}. Pass overwrite: true to write into it anyway.`;
      result.report = formatReport({
        title: `Scaffold ${options.name}`,
        summary: verdict([problem], []),
        problems: [problem],
      });
      return result;
    }
  }

  const vars = buildVars({
    id: options.id,
    name: options.name,
    description: options.description,
    author: options.author,
    authorUrl: options.authorUrl,
    version: options.version,
    minAppVersion: options.minAppVersion,
    desktopOnly: options.desktopOnly,
    packageManager: options.packageManager,
    year: new Date().getFullYear(),
  });

  let files;
  try {
    files = renderScaffoldFiles(vars, style);
  } catch (error) {
    const problem = `Template rendering failed: ${error instanceof Error ? error.message : String(error)}`;
    result.report = formatReport({
      title: `Scaffold ${options.name}`,
      summary: verdict([problem], []),
      problems: [problem],
    });
    return result;
  }

  const written: string[] = [];
  for (const file of files) {
    try {
      await fs.writeText(
        joinPath(options.targetDir, file.dest),
        file.content,
        call.policy,
        call.signal,
        call.workspaceRoot,
      );
      written.push(file.dest);
    } catch (error) {
      const problem = `Failed to write ${file.dest}: ${error instanceof Error ? error.message : String(error)}`;
      result.report = formatReport({
        title: `Scaffold ${options.name}`,
        summary: verdict([problem], []),
        problems: [problem],
        sections: [{ title: "已写入", lines: written.map((file) => `- ${file}`) }],
      });
      return result;
    }
  }

  const inspection = await inspectProject(fs, options.targetDir, call);
  result.files = written;
  result.ok = inspection.problems.length === 0;
  result.report = formatReport({
    title: `Scaffold ${options.name} → ${options.targetDir}`,
    summary: verdict(
      inspection.problems,
      inspection.warnings,
      `已写入 ${written.length} 个文件（settings: ${style}）。`,
    ),
    problems: inspection.problems,
    warnings: inspection.warnings,
    notes: inspection.notes,
    sections: [
      {
        title: "生成的文件",
        lines: written.map((file) => `- ${file}`),
      },
      {
        title: "项目元数据",
        lines: [
          `- id: ${options.id}`,
          `- name: ${options.name}`,
          `- version: ${options.version}`,
          `- minAppVersion: ${options.minAppVersion}`,
          `- isDesktopOnly: ${options.desktopOnly}`,
          `- settings API: ${style === "declarative" ? "declarative (Obsidian 1.13.0+)" : "legacy display()"}`,
        ],
      },
    ],
    nextSteps: [
      `cd ${options.targetDir} && ${options.packageManager} install`,
      "调用 obsidian_devkit_build 生成 main.js（会执行 tsc 类型检查与 esbuild 打包）。",
      "调用 obsidian_devkit_validate 复核元数据与产物。",
    ],
  });
  return result;
}
