/**
 * Plugin lifecycle actions through the official Obsidian CLI.
 *
 * The CLI is the only supported way to act on a *running* vault without
 * reimplementing Obsidian internals. Everything here is written around the
 * documented failure modes:
 *
 *  - the app has to be running, otherwise the command would cold-start it;
 *  - errors are printed while the exit code stays 0;
 *  - a hung command prints nothing, so a timeout is the only evidence;
 *  - `vault=<name>` is only honoured by some commands, and window-scoped
 *    commands talk to the frontmost window — this tool never steals focus.
 *
 * When the CLI is unavailable the tool refuses instead of falling back to
 * `wmic`/window handles: pretending to reload would be worse than saying no.
 */
import { activeVaultName, actionArgs, cliVersionProblems, discoverCli, pluginDetails, runCli, summarizeCall, } from "./cli.js";
import { inspectProject } from "./manifest.js";
import { formatReport, codeBlock } from "./report.js";
const ACTION_LABELS = {
    reload: "重载插件（plugin:reload）",
    rescan: "重新扫描插件列表（eval app.plugins.loadManifests()）",
    enable: "启用插件（plugin:enable）",
    disable: "禁用插件（plugin:disable）",
};
const CLI_UNAVAILABLE_STEPS = [
    "确认 Obsidian 版本 ≥ 1.12.4：设置 → 通用 → 命令行界面（Command line interface），启用后重启 Obsidian。",
    "确认 `obsidian` 在 PATH 中：Windows 安装目录 C:\\Users\\<你>\\AppData\\Local\\Programs\\Obsidian 已加入用户 PATH 的话，需重启终端/宿主使其生效。",
    "也可以设置环境变量 OBSIDIAN_CLI 指向 Obsidian 可执行文件（例如 ...\\Obsidian\\Obsidian.com）。",
    "本工具不会用 AppleScript / 窗口句柄等非官方途径操作 Obsidian；CLI 不可用时就只能走文件级部署（obsidian-devkit deploy）。",
];
export async function reloadLive(fs, options, call) {
    const problems = [];
    const warnings = [];
    const notes = [];
    const sections = [];
    const nextSteps = [];
    const finish = (id) => {
        const summary = problems.length > 0
            ? `FAIL — ${problems.length} 个阻塞问题`
            : `PASS — ${ACTION_LABELS[options.action]} 已执行${id === null ? "" : `（插件 ${id}）`}`;
        const report = formatReport({
            title: "Obsidian 插件重载",
            summary,
            problems,
            warnings,
            notes,
            sections,
            nextSteps,
        });
        return { report, ok: problems.length === 0, action: options.action, pluginId: id };
    };
    // Resolve the plugin id: explicit argument, or the manifest in the project.
    let id = options.pluginId?.trim() ?? "";
    let projectVersion = null;
    if (id.length === 0 && options.projectDir !== undefined) {
        const inspection = await inspectProject(fs, options.projectDir, call);
        if (inspection.manifest === null) {
            problems.push(`无法从 ${options.projectDir} 读取 manifest.json 来确定插件 id；请显式传 pluginId，或先修正项目。`);
            return finish(null);
        }
        id = inspection.manifest.id;
        projectVersion = inspection.manifest.version;
    }
    if (id.length === 0) {
        problems.push("需要 pluginId，或一个能读出 manifest id 的 projectDir。");
        return finish(null);
    }
    if (!/^[a-z0-9_-]+$/.test(id)) {
        problems.push(`插件 id "${id}" 不合法（小写字母/数字/下划线/连字符）。`);
        return finish(id);
    }
    const discovery = options.deps?.discovery ??
        discoverCli({ command: options.cliCommand });
    if (!discovery.appRunning) {
        problems.push("Obsidian 未运行：实时重载需要一个正在运行的 Obsidian 实例（CLI 冷启动会拉起应用，工具不会这么做）。先手动打开 Obsidian，或改用 obsidian-devkit deploy。");
        nextSteps.push(...CLI_UNAVAILABLE_STEPS.slice(0, 1));
        return finish(id);
    }
    if (!discovery.available) {
        problems.push(`Obsidian CLI 不可用：${discovery.detail}`);
        nextSteps.push(...CLI_UNAVAILABLE_STEPS);
        return finish(id);
    }
    warnings.push(...cliVersionProblems(discovery));
    const readActive = options.deps?.activeVault ?? ((target) => activeVaultName(target));
    const activeName = readActive(discovery);
    const vaultScope = options.vault?.trim() === "" ? undefined : options.vault?.trim();
    if (vaultScope !== undefined && activeName !== null && vaultScope !== activeName) {
        warnings.push(`目标 vault "${vaultScope}" 不是当前前台 vault "${activeName}"；官方 CLI 对窗口级命令（plugin:reload 等）只作用于前台窗口，vault= 选项并不对它们生效。请先在 Obsidian 中切到目标 vault。`);
    }
    const cliOptions = {
        timeoutMs: options.timeoutMs,
        deps: options.deps?.run === undefined ? undefined : { run: options.deps.run },
    };
    const commandArgs = actionArgs(options.action, id, vaultScope);
    const cli = runCli(discovery.command, commandArgs, cliOptions);
    if (cli.status === "timeout") {
        problems.push(`CLI 在 ${Math.round(options.timeoutMs / 1000)} 秒内没有返回（官方文档：挂起时 CLI 无输出）。Obsidian 可能忙碌或窗口被隐藏；请重启 Obsidian 后重试。`);
    }
    else if (cli.status === "unavailable") {
        problems.push(`执行过程中 CLI 变为不可用：${cli.output}`);
    }
    else if (cli.status === "silent-error") {
        const output = cli.output;
        if (/not found/i.test(output)) {
            problems.push(`CLI 报告插件 "${id}" 未被发现（${output.split(/\r?\n/)[0]}）。这通常意味着插件没有部署到该 vault，或 vault 加载后新增的插件文件夹需要先 rescan。`);
            nextSteps.push("先运行 obsidian-devkit deploy 确认文件就位，然后用 obsidian-devkit reload --action rescan 让 Obsidian 重新发现插件。");
        }
        else if (/not enabled/i.test(output)) {
            problems.push(`CLI 报告插件 "${id}" 未启用（该操作要求插件已启用）。先执行 action=enable，或在 设置 → 第三方插件 中启用。`);
            nextSteps.push("本工具可以执行 action=enable 直接把该 id 加入启用列表（不代替用户做信任决定）。");
        }
        else {
            problems.push(`CLI 返回错误：${output}`);
        }
    }
    else if (cli.status === "empty") {
        notes.push("CLI 没有输出。官方 CLI 在命令挂起时同样没有输出，所以空输出只能算“可能成功”，下面用只读查询做一次真机验证。");
    }
    // Read-only verification: what does the running app actually see?
    const readDetails = options.deps?.details ?? ((target, plugin) => pluginDetails(target, plugin));
    const verification = readDetails(discovery, id);
    const details = verification.details;
    const activeLine = activeName === null ? "unknown（无法读取当前前台 vault）" : activeName;
    if (details === null) {
        if (verification.error !== null && /not found/i.test(verification.error)) {
            warnings.push(`只读验证：插件 "${id}" 当前不在 Obsidian 的插件列表中${options.action === "rescan" ? "（rescan 后仍未发现）" : "（若刚部署，可能需要先 rescan）"}。`);
        }
        else if (verification.error !== null) {
            warnings.push(`只读验证失败：${verification.error}`);
        }
        else {
            warnings.push("只读验证未返回插件信息。");
        }
    }
    else {
        const state = details.enabled === true ? "启用" : details.enabled === false ? "未启用" : "启用状态未知";
        notes.push(`只读验证：Obsidian 看到插件 "${details.id}"，版本 ${details.version ?? "未知"}，当前${state}。`);
        if (options.action === "enable" && details.enabled !== true) {
            problems.push("action=enable 已执行，但只读验证仍显示未启用：检查该 vault 是否处于受限模式（Restricted mode）或插件在加载时抛错。");
            nextSteps.push("打开该 vault，查看 设置 → 第三方插件；若开启受限模式，先关闭，再重新 enable。");
        }
        if (options.action === "disable" && details.enabled !== false) {
            problems.push("action=disable 已执行，但只读验证仍显示启用；可稍后重试或改用插件目录中的 enabled 文件检查。");
        }
    }
    if (projectVersion !== null && details?.version !== null && details?.version !== undefined && details.version !== projectVersion) {
        warnings.push(`Obsidian 中加载的版本（${details.version}）与项目 manifest（${projectVersion}）不一致；部署后需要重载才会生效。`);
    }
    sections.push({
        title: "CLI 探测",
        lines: [
            `- 命令：${discovery.command ?? "(unavailable)"}`,
            `- 版本：${discovery.version ?? "未知"}`,
            `- 前台 vault：${activeLine}`,
            `- 探测详情：${discovery.detail}`,
        ],
    });
    sections.push({
        title: "执行",
        lines: [
            `- 动作：${ACTION_LABELS[options.action]}`,
            `- 命令：${cli.commandLine}`,
            `- 结果：${cli.status}（exit ${cli.exitCode === null ? "?" : cli.exitCode}，${cli.durationMs} ms）`,
            codeBlock(summarizeCall(cli)),
        ],
    });
    sections.push({
        title: "真机验证（只读）",
        lines: [
            `- ${details === null ? "插件信息不可读" : `插件 ${details.id}：${details.name ?? "(无名)"} @ ${details.version ?? "?"}，${details.enabled === true ? "已启用" : details.enabled === false ? "未启用" : "状态未知"}`}`,
            "- 说明：本工具只做只读查询，不切换窗口、不抢焦点；窗口级命令作用于当前前台 vault。",
        ],
    });
    if (options.action === "rescan") {
        notes.push("rescan 只是让 Obsidian 重新读取 .obsidian/plugins/* 的 manifest；不会启用或运行插件。");
    }
    nextSteps.push(options.action === "reload"
        ? "重载后若行为未更新，检查构建产物是否重新部署（obsidian-devkit deploy）并确认 main.js 是生产构建。"
        : "用 obsidian-devkit status 复查插件启用状态与部署漂移。");
    return finish(id);
}
/** Both the action list and the report use the same labels. */
export function reloadActionValues() {
    return ["reload", "rescan", "enable", "disable"];
}
//# sourceMappingURL=reload.js.map