/**
 * Subprocess execution.
 *
 * Two hard rules, learned from the Obsidian CLI and from build tooling:
 *
 *  - every child process gets a timeout; a hung `pnpm install` must never freeze
 *    the agent turn, and a timed-out tool call has to say so explicitly;
 *  - a missing executable is a distinct outcome from a failing one, because the
 *    fix is different (install the tool vs. read the error output).
 */
import { spawnSync } from "node:child_process";
const NEEDS_QUOTE = /[\s"'\\$`&|;<>()*?{}[\]]/;
function quotePosix(arg) {
    return NEEDS_QUOTE.test(arg) ? `'${arg.replace(/'/g, `'\\''`)}'` : arg;
}
function quoteWindows(arg) {
    if (!NEEDS_QUOTE.test(arg))
        return arg;
    return `"${arg.replace(/"/g, '""')}"`;
}
function quoteForDisplay(arg) {
    return process.platform === "win32" ? quoteWindows(arg) : quotePosix(arg);
}
export function run(spec) {
    const started = Date.now();
    const args = spec.args ?? [];
    const timeoutMs = spec.timeoutMs ?? 120_000;
    const commandLine = [spec.command, ...args].map(quoteForDisplay).join(" ");
    const env = { ...process.env, ...(spec.env ?? {}) };
    const common = {
        cwd: spec.cwd,
        timeout: timeoutMs,
        encoding: "utf8",
        env,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
    };
    let result;
    try {
        result =
            process.platform === "win32"
                ? spawnSync([quoteWindows(spec.command), ...args.map(quoteWindows)].join(" "), { ...common, shell: true })
                : spawnSync(spec.command, args, { ...common, shell: false });
    }
    catch (error) {
        return {
            status: "missing",
            commandLine,
            exitCode: null,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - started,
        };
    }
    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    const durationMs = Date.now() - started;
    const errorCode = result.error?.code;
    if (errorCode === "ETIMEDOUT" || result.signal === "SIGTERM") {
        return {
            status: "timeout",
            commandLine,
            exitCode: null,
            stdout,
            stderr,
            durationMs,
        };
    }
    if (errorCode === "ENOENT") {
        return {
            status: "missing",
            commandLine,
            exitCode: null,
            stdout,
            stderr: stderr || `Command not found: ${spec.command}`,
            durationMs,
        };
    }
    return {
        status: result.status === 0 ? "ok" : "failed",
        commandLine,
        exitCode: result.status,
        stdout,
        stderr,
        durationMs,
    };
}
/** Last `limit` characters of combined child output, for tool reports. */
export function tailOutput(result, limit = 1500) {
    const combined = [result.stdout.trim(), result.stderr.trim()]
        .filter((part) => part.length > 0)
        .join("\n");
    if (combined.length <= limit)
        return combined;
    return `…${combined.slice(combined.length - limit)}`;
}
//# sourceMappingURL=proc.js.map