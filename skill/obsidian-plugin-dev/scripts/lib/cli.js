/**
 * The official Obsidian CLI channel.
 *
 * Three rules from the Obsidian developer docs shape every function here:
 *
 *  - the app must already be running; a CLI invocation can cold-start Obsidian,
 *    and a tool must never surprise the user by opening windows;
 *  - the exit code is not the result: the CLI prints `Error: ...` and still
 *    exits 0, so the text has to be classified;
 *  - a hung invocation prints nothing, so every call is timeout-bounded and
 *    "empty output" is reported instead of being read as success.
 *
 * The CLI is optional: when it is unavailable, callers must degrade to
 * file-level deployment and say so, never invent a live-app result.
 */
import { join } from "node:path";
import { compareSemver } from "./naming.js";
import { run, tailOutput } from "./proc.js";
/**
 * Candidate CLI invocations, most specific first. `OBSIDIAN_CLI` always wins so
 * a user can point the tool at an unusual install without editing the bundle.
 */
export function cliCandidates(env = process.env, platform = process.platform) {
    const candidates = [];
    const push = (value) => {
        if (typeof value === "string" && value.trim().length > 0 && !candidates.includes(value)) {
            candidates.push(value);
        }
    };
    push(env.OBSIDIAN_CLI);
    if (platform === "win32") {
        const localAppData = env.LOCALAPPDATA;
        if (localAppData) {
            push(join(localAppData, "Programs", "Obsidian", "Obsidian.com"));
            push(join(localAppData, "Programs", "Obsidian", "Obsidian.exe"));
        }
        if (env.ProgramFiles)
            push(join(env.ProgramFiles, "Obsidian", "Obsidian.com"));
        if (env.ProgramFiles)
            push(join(env.ProgramFiles, "Obsidian", "Obsidian.exe"));
    }
    else if (platform === "darwin") {
        push("/Applications/Obsidian.app/Contents/MacOS/Obsidian");
    }
    else {
        if (env.HOME)
            push(join(env.HOME, ".local", "bin", "obsidian"));
        push("/usr/bin/obsidian");
        push("/opt/Obsidian/obsidian");
    }
    push("obsidian");
    return candidates;
}
/** Is an Obsidian process running? Checked before probing the CLI. */
export function obsidianIsRunning(deps = {}, platform = process.platform) {
    const runner = deps.run ?? run;
    const cwd = process.cwd();
    if (platform === "win32") {
        const result = runner({
            command: "tasklist",
            args: ["/FI", "IMAGENAME eq Obsidian.exe"],
            cwd,
            timeoutMs: 20_000,
        });
        return result.status === "ok" && /obsidian\.exe/i.test(result.stdout);
    }
    if (platform === "darwin") {
        const result = runner({ command: "pgrep", args: ["-x", "Obsidian"], cwd, timeoutMs: 20_000 });
        return result.status === "ok" && result.stdout.trim().length > 0;
    }
    const result = runner({ command: "pgrep", args: ["-f", "obsidian"], cwd, timeoutMs: 20_000 });
    return result.status === "ok" && result.stdout.trim().length > 0;
}
/**
 * Find a usable CLI. When Obsidian is not running the probe is skipped on
 * purpose: running `obsidian version` would launch the app.
 */
export function discoverCli(options = {}) {
    const deps = options.deps ?? {};
    const running = deps.appRunning === undefined ? obsidianIsRunning(deps) : deps.appRunning();
    if (!running) {
        return {
            appRunning: false,
            available: false,
            command: null,
            version: null,
            detail: "Obsidian 未运行；为避免 CLI 冷启动拉起应用，未探测 CLI。先手动打开 Obsidian 再重试实时操作。",
        };
    }
    const timeoutMs = options.timeoutMs ?? 15_000;
    const candidates = options.command === undefined ? cliCandidates() : [options.command];
    const runner = deps.run ?? run;
    let detail = "";
    for (const candidate of candidates) {
        const result = runner({ command: candidate, args: ["version"], cwd: process.cwd(), timeoutMs });
        const text = [result.stdout.trim(), result.stderr.trim()].filter((part) => part.length > 0).join("\n");
        if (result.status === "timeout") {
            detail = `${candidate} 探测超时`;
            break;
        }
        if (result.status === "missing")
            continue;
        if (/not recognized as an internal|command not found|无法将|不是内部或外部命令/i.test(text))
            continue;
        if (/unable to find obsidian/i.test(text)) {
            detail = `${candidate}: ${text}`;
            break;
        }
        const version = text.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
        if (text.length === 0)
            continue;
        return {
            appRunning: true,
            available: true,
            command: candidate,
            version,
            detail: `${candidate} → ${text.split(/\r?\n/)[0]}`,
        };
    }
    return {
        appRunning: true,
        available: false,
        command: null,
        version: null,
        detail: detail.length > 0
            ? detail
            : `未找到可用的 Obsidian CLI（尝试了 ${candidates.length} 个候选）。需要 Obsidian 1.12.4+，并在 设置 → 通用 → 命令行界面 中启用。`,
    };
}
export function cliVersionProblems(discovery) {
    if (!discovery.available || discovery.version === null)
        return [];
    if (compareSemver(discovery.version, "1.12.4") < 0) {
        return [`Obsidian CLI 版本 ${discovery.version} 低于 1.12.4；部分命令可能不可用。`];
    }
    return [];
}
const MISSING_CLI = {
    status: "unavailable",
    output: "（Obsidian CLI 不可用）",
    commandLine: "(obsidian CLI unavailable)",
    durationMs: 0,
    exitCode: null,
};
/** Run one CLI command and classify its output instead of trusting the exit code. */
export function runCli(command, args, options = {}) {
    if (command === null)
        return { ...MISSING_CLI };
    const runner = options.deps?.run ?? run;
    const result = runner({
        command,
        args,
        cwd: options.cwd ?? process.cwd(),
        timeoutMs: options.timeoutMs ?? 30_000,
    });
    const output = [result.stdout.trim(), result.stderr.trim()].filter((part) => part.length > 0).join("\n");
    const base = {
        output,
        commandLine: result.commandLine,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
    };
    if (result.status === "timeout") {
        return { ...base, status: "timeout", output: output.length === 0 ? "（命令无输出并已超时）" : output };
    }
    if (result.status === "missing") {
        return { ...base, status: "unavailable", output: result.stderr || "命令不可用" };
    }
    if (/not recognized as an internal|无法将.*识别|不是内部或外部命令|command not found|ENOENT/i.test(output)) {
        return { ...base, status: "unavailable" };
    }
    if (/unable to find obsidian/i.test(output)) {
        return { ...base, status: "unavailable" };
    }
    if (output.length === 0) {
        return {
            ...base,
            status: "empty",
            output: "（命令没有输出；官方 CLI 对挂起/失败命令也可能静默返回空输出）",
        };
    }
    if (/^Error:/m.test(output)) {
        // The CLI prints Error: ... and still exits 0. Treat it as a result, not an exception.
        return { ...base, status: "silent-error" };
    }
    if (result.status !== "ok") {
        return { ...base, status: "error" };
    }
    return { ...base, status: "ok" };
}
/** The vault currently focused in the Obsidian window (null when unknown). */
export function activeVaultName(discovery, options = {}) {
    if (!discovery.available)
        return null;
    const call = runCli(discovery.command, ["eval", "code=app.vault.getName()"], options);
    if (call.status !== "ok")
        return null;
    const match = call.output.match(/=>\s*(.+)/);
    const name = match?.[1]?.trim();
    return name !== undefined && name.length > 0 ? name : null;
}
/** Community plugins enabled in the active vault, or null when unreadable. */
export function enabledPluginIds(discovery, options = {}) {
    if (!discovery.available)
        return null;
    const call = runCli(discovery.command, ["plugins:enabled", "filter=community", "format=json"], options);
    if (call.status !== "ok")
        return null;
    const start = call.output.indexOf("[");
    const end = call.output.lastIndexOf("]");
    if (start < 0 || end <= start)
        return null;
    try {
        const parsed = JSON.parse(call.output.slice(start, end + 1));
        if (!Array.isArray(parsed))
            return null;
        const ids = [];
        for (const item of parsed) {
            if (typeof item === "string")
                ids.push(item);
            else if (typeof item === "object" && item !== null) {
                const id = item.id;
                if (typeof id === "string")
                    ids.push(id);
            }
        }
        return ids;
    }
    catch {
        return null;
    }
}
/** Read one plugin's manifest through the CLI (`obsidian plugin id=<id>`). */
export function pluginDetails(discovery, id, options = {}) {
    const call = runCli(discovery.command, ["plugin", `id=${id}`], options);
    if (call.status === "unavailable" || call.status === "timeout") {
        return { details: null, error: call.output, call };
    }
    if (call.status === "silent-error" || call.status === "error") {
        const error = /not found/i.test(call.output)
            ? `插件 "${id}" 未被 Obsidian 发现（可能未安装、vault 未加载，或需要 rescan）。`
            : call.output;
        return { details: null, error, call };
    }
    const fields = {};
    for (const line of call.output.split(/\r?\n/)) {
        const separator = line.indexOf("\t");
        if (separator > 0) {
            fields[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
            continue;
        }
        const equals = line.indexOf("=");
        if (equals > 0)
            fields[line.slice(0, equals).trim().toLowerCase()] = line.slice(equals + 1).trim();
    }
    const resolvedId = fields.id ?? fields.plugin ?? "";
    if (resolvedId.length === 0) {
        return { details: null, error: `无法解析插件信息输出：${call.output || "(空)"}`, call };
    }
    const enabledText = (fields.enabled ?? "").toLowerCase();
    return {
        details: {
            id: resolvedId,
            name: fields.name ?? null,
            version: fields.version ?? null,
            enabled: enabledText === "true" ? true : enabledText === "false" ? false : null,
            author: fields.author ?? null,
            description: fields.description ?? null,
            raw: call.output,
        },
        error: null,
        call,
    };
}
/** Official CLI argument vector for one lifecycle action. */
export function actionArgs(action, id, vault) {
    const scope = vault === undefined || vault.trim().length === 0 ? [] : [`vault=${vault.trim()}`];
    switch (action) {
        case "reload":
            return ["plugin:reload", `id=${id}`, ...scope];
        case "enable":
            return ["plugin:enable", `id=${id}`, ...scope];
        case "disable":
            return ["plugin:disable", `id=${id}`, ...scope];
        case "rescan":
            return ["eval", "code=app.plugins.loadManifests()", ...scope];
    }
}
export function runAction(discovery, action, id, vault, options = {}) {
    return runCli(discovery.command, actionArgs(action, id, vault), options);
}
/** Last output lines, for inline reports. */
export function summarizeCall(call, limit = 1200) {
    const text = call.output.trim();
    if (text.length <= limit)
        return text;
    return `…${text.slice(text.length - limit)}`;
}
export { tailOutput };
//# sourceMappingURL=cli.js.map