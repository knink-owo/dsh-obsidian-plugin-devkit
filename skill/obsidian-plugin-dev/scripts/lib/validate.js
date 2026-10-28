import { inspectProject, joinPath } from "./manifest.js";
import { formatReport, verdict } from "./report.js";
export async function validateProject(fs, projectDir, call) {
    const inspection = await inspectProject(fs, projectDir, call);
    const problems = [...inspection.problems];
    const warnings = [...inspection.warnings];
    const notes = [...inspection.notes];
    if (inspection.bundleText === null) {
        problems.push("No built main.js found; run obsidian-devkit build before validating a deliverable.");
    }
    if (!(await fs.exists(joinPath(projectDir, "README.md"), call.workspaceRoot))) {
        warnings.push("No README.md; the community listing and reviewers expect a usable one.");
    }
    if (!(await fs.exists(joinPath(projectDir, "LICENSE"), call.workspaceRoot))) {
        warnings.push("No LICENSE file in the project; plugins should be open source for the community directory.");
    }
    if (!(await fs.exists(joinPath(projectDir, "AGENTS.md"), call.workspaceRoot))) {
        notes.push("No AGENTS.md; adding one gives coding agents the project-specific rules (CommonJS bundle, no default hotkeys, unload cleanup).");
    }
    const ok = problems.length === 0;
    const manifest = inspection.manifest;
    const sections = [];
    if (manifest !== null) {
        sections.push({
            title: "项目",
            lines: [
                `- 目录: \`${inspection.absoluteDir}\``,
                `- id: ${manifest.id}`,
                `- name: ${manifest.name}`,
                `- version: ${manifest.version} · minAppVersion: ${manifest.minAppVersion}`,
                `- isDesktopOnly: ${String(manifest.isDesktopOnly)}`,
                `- settings API: ${inspection.settingsStyle}`,
                `- 入口: ${inspection.entry ?? "未找到"}`,
                `- 产物: ${inspection.bundle === null ? "未构建" : `${inspection.bundle} (${inspection.bundleSize ?? 0} bytes)`}`,
                `- tsconfig: ${inspection.hasTsconfig ? "有" : "无"} · eslint: ${inspection.hasEslint ? "有" : "无"}`,
            ],
        });
    }
    sections.push({
        title: "发布前还需确认（工具无法代替）",
        lines: [
            "- 在 Obsidian 里真实安装并启用，手工验证每条命令、每个视图与设置项。",
            "- GitHub release tag 必须等于 manifest.version；assets 附 main.js、manifest.json、styles.css。",
            "- 通过 https://community.obsidian.md → Plugins → New plugin 提交，遵守开发者政策（无混淆、无广告、无客户端遥测、无自更新）。",
        ],
    });
    const report = formatReport({
        title: `Validate ${manifest?.id ?? projectDir}`,
        summary: verdict(problems, warnings, `交付检查通过：${manifest?.id ?? "项目"} ${manifest?.version ?? ""} 可以进入发布流程。`),
        problems,
        warnings,
        notes,
        sections,
        nextSteps: ok
            ? [
                "调用 obsidian-devkit version 提升版本号并同步 manifest/package/versions.json。",
                "git commit 后打 tag 并创建 GitHub release（assets: main.js、manifest.json、styles.css）。",
            ]
            : ["按上面的阻塞问题逐项修复，再重新调用 obsidian-devkit validate。"],
    });
    return { ok, report };
}
//# sourceMappingURL=validate.js.map