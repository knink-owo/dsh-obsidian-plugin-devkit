/**
 * Build tool.
 *
 * Strategy: use the project's own build script when it has one (the official
 * template's script type-checks and bundles in one go), fall back to the local
 * esbuild binary, and refuse to cook up a build the project did not declare.
 *
 * A successful exit is not a verdict. Every build is followed by the same
 * inspection `validate` uses, because the failure modes that matter (an ESM
 * bundle, unsynced versions, a missing artifact) do not produce a non-zero exit.
 */
import type { Fs } from "./fs.js";
import {
  inspectProject,
  joinPath,
  readBuildConfig,
} from "./manifest.js";
import { codeBlock, formatReport, verdict } from "./report.js";
import { run, tailOutput } from "./proc.js";
import type { FsCall } from "./types.js";

export interface BuildOptions {
  projectDir: string;
  production: boolean;
  entry?: string;
  outDir?: string;
  timeoutMs: number;
  packageManager: string;
}

export interface BuildResult {
  ok: boolean;
  bundle: string | null;
  report: string;
}

const LOCKFILES: Array<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

export async function detectPackageManager(
  fs: Fs,
  projectDir: string,
  fallback: string,
  call: FsCall,
): Promise<string> {
  for (const [lockfile, manager] of LOCKFILES) {
    if (await fs.exists(joinPath(projectDir, lockfile), call.workspaceRoot)) {
      return manager;
    }
  }
  return fallback;
}

function esbuildBinaryExists(fs: Fs, projectDir: string, call: FsCall): Promise<boolean> {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return fs.exists(joinPath(projectDir, `node_modules/.bin/esbuild${suffix}`), call.workspaceRoot);
}

function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "." : normalized.slice(0, index) || ".";
}

export async function buildPlugin(
  fs: Fs,
  options: BuildOptions,
  call: FsCall,
): Promise<BuildResult> {
  const inspection = await inspectProject(fs, options.projectDir, call);
  if (inspection.manifest === null || inspection.packageJson === null || inspection.entry === null) {
    const problems = inspection.problems.filter(
      (problem) =>
        /manifest\.json|package\.json|entry point|Project directory/.test(problem),
    );
    return {
      ok: false,
      bundle: null,
      report: formatReport({
        title: `Build ${options.projectDir}`,
        summary: verdict(problems, inspection.warnings, "项目结构不完整，未执行构建。"),
        problems,
        warnings: inspection.warnings,
      }),
    };
  }

  const entry = options.entry ?? inspection.entry;
  const buildConfig = await readBuildConfig(fs, options.projectDir, call);
  const outfileMatch = buildConfig?.match(/outfile\s*:\s*['"]([^'"]+)['"]/);
  const configuredOutfile = outfileMatch?.[1] ?? "main.js";
  const bundleRel = options.outDir
    ? joinPath(options.outDir, "main.js")
    : configuredOutfile;
  const outDir = options.outDir ?? parentDir(configuredOutfile);
  const packageManager = await detectPackageManager(
    fs,
    options.projectDir,
    options.packageManager,
    call,
  );

  const buildScript = inspection.packageJson.scripts?.build;
  let command: string;
  let args: string[];
  if (typeof buildScript === "string" && buildScript.trim().length > 0) {
    command = packageManager;
    args = ["run", "build"];
  } else if (await esbuildBinaryExists(fs, options.projectDir, call)) {
    const suffix = process.platform === "win32" ? ".cmd" : "";
    command = joinPath(options.projectDir, `node_modules/.bin/esbuild${suffix}`);
    const externalArgs = ["--bundle", "--format=cjs", "--target=es2021", "--log-level=warning"]
      .concat(["--external:obsidian", "--external:electron", "--external:@codemirror/*", "--external:@lezer/*"])
      .concat([`--outfile=${joinPath(outDir, "main.js")}`])
      .concat(options.production ? ["--minify"] : ["--sourcemap=inline"]);
    args = [entry, ...externalArgs];
  } else {
    const problem =
      "package.json has no build script and node_modules/.bin/esbuild is missing. Run the package manager's install command first.";
    return {
      ok: false,
      bundle: null,
      report: formatReport({
        title: `Build ${options.projectDir}`,
        summary: verdict([problem], inspection.warnings, "未执行构建。"),
        problems: [problem],
        warnings: inspection.warnings,
        nextSteps: [`cd ${options.projectDir} && ${packageManager} install`],
      }),
    };
  }

  const result = run({
    command,
    args,
    cwd: inspection.absoluteDir,
    timeoutMs: options.timeoutMs,
    env: { CI: "1" },
  });

  const commandSection = [
    `- 命令: \`${result.commandLine}\``,
    `- 退出码: ${result.exitCode === null ? "无（超时或未启动）" : result.exitCode}`,
    `- 耗时: ${(result.durationMs / 1000).toFixed(1)}s`,
  ];

  if (result.status === "timeout") {
    const problem = `Build timed out after ${(options.timeoutMs / 1000).toFixed(0)}s; the process was killed.`;
    return {
      ok: false,
      bundle: null,
      report: formatReport({
        title: `Build ${inspection.manifest.id}`,
        summary: verdict([problem], [], "构建超时。"),
        problems: [problem],
        sections: [{ title: "构建命令", lines: commandSection }],
      }),
    };
  }
  if (result.status === "missing") {
    const problem = `Could not start \`${command}\`; is it installed and on PATH? (${tailOutput(result, 300)})`;
    return {
      ok: false,
      bundle: null,
      report: formatReport({
        title: `Build ${inspection.manifest.id}`,
        summary: verdict([problem], [], "构建命令无法启动。"),
        problems: [problem],
        sections: [{ title: "构建命令", lines: commandSection }],
      }),
    };
  }
  if (result.status !== "ok") {
    const problem = `Build command failed with exit code ${result.exitCode}.`;
    return {
      ok: false,
      bundle: null,
      report: formatReport({
        title: `Build ${inspection.manifest.id}`,
        summary: verdict([problem], [], "构建失败。"),
        problems: [problem],
        sections: [
          { title: "构建命令", lines: commandSection },
          { title: "输出（末尾）", lines: [codeBlock(tailOutput(result, 2000))] },
        ],
      }),
    };
  }

  const post = await inspectProject(fs, options.projectDir, call);
  const problems = [...post.problems];
  const warnings = [...post.warnings];
  const artifactPath = joinPath(options.projectDir, bundleRel);

  if (post.bundleText === null) {
    problems.push(
      `Build exited successfully but ${bundleRel} was not found at ${artifactPath}; check the esbuild outfile option.`,
    );
  } else {
    if (options.production && /sourceMappingURL=data:/.test(post.bundleText)) {
      warnings.push("Production bundle contains an inline source map; disable sourcemap for release builds.");
    }
    if (!options.production) {
      warnings.push("Built a development bundle (not minified); run with production: true before deploying.");
    }
  }

  const ok = problems.length === 0;
  const report = formatReport({
    title: `Build ${post.manifest?.id ?? options.projectDir}`,
    summary: verdict(
      problems,
      warnings,
      `${options.production ? "生产" : "开发"}构建完成${post.bundleSize !== null ? `，main.js ${(post.bundleSize / 1024).toFixed(1)} KB` : ""}。`,
    ),
    problems,
    warnings,
    notes: post.notes,
    sections: [
      { title: "构建命令", lines: commandSection },
      {
        title: "产物",
        lines: [
          `- 路径: ${artifactPath}`,
          `- 入口: ${entry}`,
          `- 大小: ${post.bundleSize === null ? "未生成" : `${post.bundleSize} bytes`}`,
          `- 模块格式: ${post.bundleText?.includes("module.exports") ? "CommonJS（Obsidian 可加载）" : "无法确认"}`,
        ],
      },
    ],
    nextSteps: ok
      ? [
          "调用 obsidian_devkit_validate 做交付前复核。",
          "把 main.js、manifest.json、styles.css 部署到开发 vault 的 .obsidian/plugins/<id>/（M2 的 deploy 工具将自动化这一步）。",
        ]
      : ["根据上面的阻塞问题修复后重新构建。"],
  });
  return { ok, bundle: post.bundle === null ? null : bundleRel, report };
}
