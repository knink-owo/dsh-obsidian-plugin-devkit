/**
 * The filesystem seam.
 *
 * All reads and writes go through the harness' `ctx.fs` service when it is
 * present, so the sandbox policy decided by the host is honoured. A plain
 * `node:fs` fallback keeps the pure functions (naming, scaffolding, version
 * bumping) testable outside the harness.
 *
 * Three rules, verified against the host contract:
 *
 *  - `ctx.fs.resolve(path)` bases relative paths on the host process' cwd, not
 *    on the session workspace. Every relative path therefore has to be resolved
 *    against an explicit workspace root.
 *  - There are two path identities. `FsTarget` (from `resolve`) is an opaque
 *    key used for reads and writes; the absolute OS path (from `processPath`)
 *    is what a subprocess can open. Mixing them silently defeats the sandbox.
 *  - Every mutating call carries the calling session's sandbox policy so the
 *    backend fences writes against the session workspace rather than a
 *    process-wide default.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
export class Fs {
    fs;
    constructor(fs) {
        this.fs = fs;
    }
    /** Resolve a model-supplied path into both path identities. */
    async locate(path, workspaceRoot) {
        if (this.fs) {
            const target = await this.fs.resolve(path, workspaceRoot === undefined ? undefined : { cwd: workspaceRoot });
            let absolute = target.displayPath;
            if (typeof this.fs.processPath === "function") {
                try {
                    absolute = this.fs.processPath(target);
                }
                catch {
                    /* keep displayPath */
                }
            }
            return { path: absolute, target };
        }
        const absolute = isAbsolute(path)
            ? path
            : resolve(workspaceRoot ?? process.cwd(), path);
        return { path: absolute, target: undefined };
    }
    /** Absolute OS path. Pass this to subprocesses, never to `ctx.fs` I/O. */
    async resolve(path, workspaceRoot) {
        return (await this.locate(path, workspaceRoot)).path;
    }
    async exists(path, workspaceRoot) {
        if (this.fs) {
            try {
                return (await this.fs.stat((await this.locate(path, workspaceRoot)).target)) !== undefined;
            }
            catch {
                return false;
            }
        }
        return existsSync(await this.resolve(path, workspaceRoot));
    }
    async isDirectory(path, workspaceRoot) {
        if (this.fs) {
            try {
                const info = await this.fs.stat((await this.locate(path, workspaceRoot)).target);
                return Boolean(info?.isDirectory ?? info?.type === "directory");
            }
            catch {
                return false;
            }
        }
        try {
            return (await stat(await this.resolve(path, workspaceRoot))).isDirectory();
        }
        catch {
            return false;
        }
    }
    async readText(path, workspaceRoot) {
        if (this.fs) {
            return await this.fs.readText((await this.locate(path, workspaceRoot)).target);
        }
        return readFile(await this.resolve(path, workspaceRoot), "utf8");
    }
    async readJson(path, workspaceRoot) {
        try {
            return JSON.parse(await this.readText(path, workspaceRoot));
        }
        catch {
            return null;
        }
    }
    async writeText(path, content, policy, signal, workspaceRoot) {
        if (this.fs) {
            await this.fs.writeText((await this.locate(path, workspaceRoot)).target, content, undefined, signal, policy);
            return;
        }
        const absolute = await this.resolve(path, workspaceRoot);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, content, "utf8");
    }
    async writeJson(path, value, indent, policy, signal, workspaceRoot) {
        await this.writeText(path, JSON.stringify(value, null, indent) + "\n", policy, signal, workspaceRoot);
    }
    async listDir(path, workspaceRoot) {
        if (this.fs) {
            try {
                const entries = await this.fs.listDir((await this.locate(path, workspaceRoot)).target);
                return entries.map((entry) => String(entry?.name ?? entry));
            }
            catch {
                return [];
            }
        }
        try {
            return await readdir(await this.resolve(path, workspaceRoot));
        }
        catch {
            return [];
        }
    }
}
/** Read a package asset (templates, docs) relative to the built `lib/` folder. */
export function readAsset(relativeToLib) {
    const url = new URL(relativeToLib, import.meta.url);
    return readFileSync(url, "utf8").replace(/^\uFEFF/, "");
}
export { join };
//# sourceMappingURL=fs.js.map