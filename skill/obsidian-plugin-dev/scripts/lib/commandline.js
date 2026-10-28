#!/usr/bin/env node
/**
 * `obsidian-devkit` — the standalone CLI face of the toolkit.
 *
 * The same library modules that used to back the DSH host tools are pure Node:
 * they only need a filesystem seam. This entry parses argv, calls the library,
 * prints the (Chinese) report and maps the result to an exit code:
 *
 *   0  success
 *   1  the operation ran but failed (build error, validation problems, ...)
 *   2  usage error (unknown command/flag, missing required argument)
 *
 * It never cold-starts Obsidian, never steals focus, and never runs an e2e
 * suite: those are human/CI decisions, documented in the bundled skill.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlugin } from "./build.js";
import { deployPlugin } from "./deploy.js";
import { E2E_ACTIONS, runE2e } from "./e2e.js";
import { Fs, readAsset } from "./fs.js";
import { compareSemver } from "./naming.js";
import { reloadActionValues, reloadLive } from "./reload.js";
import { scaffold } from "./scaffold.js";
import { runSmoke, SMOKE_SCENARIOS } from "./smoke.js";
import { statusReport } from "./status.js";
import { validateProject } from "./validate.js";
import { bumpVersion } from "./version.js";
/** Defaults used when a flag is omitted; mirrors the old DSH bundle config. */
export const CLI_DEFAULTS = {
    defaultMinAppVersion: "1.13.0",
    testVault: "dev-vault",
    packageManager: "pnpm",
    obsidianCli: "obsidian",
    probeActive: true,
};
const VERSION = (() => {
    try {
        return JSON.parse(readAsset("../package.json")).version ?? "0.0.0";
    }
    catch {
        return "0.0.0";
    }
})();
const defaultIO = {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    cwd: process.cwd(),
};
class UsageError extends Error {
}
const COMMANDS = [
    "scaffold",
    "build",
    "validate",
    "version",
    "deploy",
    "status",
    "reload",
    "test",
    "e2e",
    "install-skill",
];
const SETTINGS_STYLES = ["auto", "declarative", "legacy"];
const USAGE = `obsidian-devkit ${VERSION} — Obsidian community plugin development toolkit (CLI + skill)

USAGE
  obsidian-devkit <command> [options]

COMMANDS
  scaffold <targetDir> --id <id> --name <name>
        Create a buildable, submission-ready plugin project (official rules enforced).
        options: --description <text> --author <name> --author-url <url>
                 --plugin-version <semver> --min-app-version <semver>
                 --desktop-only --settings-style auto|declarative|legacy
                 --overwrite --package-manager pnpm|npm|yarn|bun
  build <projectDir>
        Build main.js (CommonJS, obsidian external) and run static self-checks.
        options: --development --entry <file> --out-dir <dir> --timeout <ms>
  validate <projectDir>
        Pre-delivery audit: naming, manifest, version sync, CommonJS bundle, settings gate.
  version <projectDir> <semver>
        Sync manifest.json / package.json / versions.json. option: --min-app-version <semver>
  deploy <projectDir>
        Copy the build into a vault and record the deployment (no running app needed).
        options: --vault <name|path> --plugin-id <id> --no-enable --no-create-vault
                 --dry-run --test-vault <dir> --obsidian-cli <command> --no-probe
  status [projectDir]
        Read-only environment audit (Obsidian, CLI, vaults, project, deployments, drift).
        options: --vault <name|path> --test-vault <dir> --obsidian-cli <command>
  reload [projectDir]
        Drive a running Obsidian through the official CLI (>= 1.12.4, CLI enabled).
        options: --action reload|rescan|enable|disable --plugin-id <id>
                 --vault <name> --timeout <ms> --obsidian-cli <command>
  test <projectDir>
        L2 isolated smoke test of the built main.js in a Node VM with stubbed obsidian.
        options: --bundle <path> --scenario load|onload|unload --timeout <ms>
  e2e <projectDir>
        Write or audit a sandboxed WebdriverIO harness (never runs the suite).
        options: --action init|status --overwrite
  install-skill
        Install the bundled obsidian-plugin-dev skill into a DSH skills directory.
        options: --skills-dir <dir> --force

GLOBAL OPTIONS
  --cwd <dir>     Base directory for relative paths (default: current directory)
  -h, --help      This help; 'obsidian-devkit help <command>' for one command
  -V, --version   Print the version

EXIT CODES
  0 success   1 operation failed   2 usage error

The reports are printed as-is (Chinese); scripts should rely on the exit code.
`;
const VALUE_FLAGS = new Set([
    "cwd",
    "id",
    "name",
    "description",
    "author",
    "author-url",
    "plugin-version",
    "min-app-version",
    "settings-style",
    "package-manager",
    "entry",
    "out-dir",
    "timeout",
    "vault",
    "plugin-id",
    "test-vault",
    "obsidian-cli",
    "action",
    "bundle",
    "scenario",
    "skills-dir",
]);
const BOOLEAN_FLAGS = new Set([
    "overwrite",
    "desktop-only",
    "development",
    "dry-run",
    "no-enable",
    "no-create-vault",
    "no-probe",
    "force",
]);
function parseArgs(argv) {
    const positionals = [];
    const flags = new Map();
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === "-h") {
            flags.set("help", true);
            continue;
        }
        if (token === "-V") {
            flags.set("version-switch", true);
            continue;
        }
        if (token === "--version") {
            flags.set("version-switch", true);
            continue;
        }
        if (!token.startsWith("--") || token === "--") {
            positionals.push(token);
            continue;
        }
        const body = token.slice(2);
        const eq = body.indexOf("=");
        const name = eq === -1 ? body : body.slice(0, eq);
        const inlineValue = eq === -1 ? undefined : body.slice(eq + 1);
        if (name === "help") {
            flags.set("help", true);
            continue;
        }
        if (VALUE_FLAGS.has(name)) {
            if (inlineValue !== undefined) {
                flags.set(name, inlineValue);
                continue;
            }
            const next = argv[index + 1];
            if (next === undefined || next.startsWith("--")) {
                throw new UsageError(`Option --${name} requires a value.`);
            }
            flags.set(name, next);
            index += 1;
            continue;
        }
        if (BOOLEAN_FLAGS.has(name)) {
            if (inlineValue !== undefined) {
                throw new UsageError(`Option --${name} does not take a value.`);
            }
            flags.set(name, true);
            continue;
        }
        throw new UsageError(`Unknown option --${name}.`);
    }
    return { positionals, flags };
}
// ---------------------------------------------------------------------------
// flag helpers
// ---------------------------------------------------------------------------
function stringFlag(flags, name) {
    const value = flags.get(name);
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function booleanFlag(flags, name, fallback) {
    const value = flags.get(name);
    if (value === true)
        return true;
    return fallback;
}
function numberFlag(flags, name, fallback) {
    const raw = stringFlag(flags, name);
    if (raw === undefined)
        return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new UsageError(`Option --${name} must be a positive number, got "${raw}".`);
    }
    return value;
}
function requiredPositional(parsed, index, name) {
    const value = parsed.positionals[index];
    if (value === undefined || value.length === 0) {
        throw new UsageError(`Missing required argument <${name}>.`);
    }
    return value;
}
function optionalPositional(parsed, index) {
    const value = parsed.positionals[index];
    return value === undefined || value.length === 0 ? undefined : value;
}
function enumFlag(flags, name, allowed, fallback) {
    const raw = stringFlag(flags, name);
    if (raw === undefined)
        return fallback;
    if (!allowed.includes(raw)) {
        throw new UsageError(`Option --${name} must be one of: ${allowed.join(", ")}.`);
    }
    return raw;
}
function callFor(io) {
    return { workspaceRoot: io.cwd };
}
function obsidianCliFlag(flags) {
    return stringFlag(flags, "obsidian-cli") ?? process.env.OBSIDIAN_CLI ?? CLI_DEFAULTS.obsidianCli;
}
async function scaffoldCommand(parsed, io, fs) {
    const targetDir = requiredPositional(parsed, 0, "targetDir");
    const id = stringFlag(parsed.flags, "id");
    const name = stringFlag(parsed.flags, "name");
    if (id === undefined || name === undefined) {
        throw new UsageError("scaffold requires both --id and --name.");
    }
    const result = await scaffold(fs, {
        targetDir,
        id,
        name,
        description: stringFlag(parsed.flags, "description") ?? `${name} — an Obsidian plugin.`,
        author: stringFlag(parsed.flags, "author") ?? "Unknown",
        authorUrl: stringFlag(parsed.flags, "author-url"),
        version: stringFlag(parsed.flags, "plugin-version") ?? "0.1.0",
        minAppVersion: stringFlag(parsed.flags, "min-app-version") ?? CLI_DEFAULTS.defaultMinAppVersion,
        desktopOnly: booleanFlag(parsed.flags, "desktop-only", false),
        settingsStyle: enumFlag(parsed.flags, "settings-style", SETTINGS_STYLES, "auto"),
        overwrite: booleanFlag(parsed.flags, "overwrite", false),
        packageManager: stringFlag(parsed.flags, "package-manager") ?? CLI_DEFAULTS.packageManager,
    }, callFor(io));
    io.out(result.report);
    return result.ok ? 0 : 1;
}
async function buildCommand(parsed, io, fs) {
    const projectDir = requiredPositional(parsed, 0, "projectDir");
    const result = await buildPlugin(fs, {
        projectDir,
        production: !booleanFlag(parsed.flags, "development", false),
        entry: stringFlag(parsed.flags, "entry"),
        outDir: stringFlag(parsed.flags, "out-dir"),
        timeoutMs: numberFlag(parsed.flags, "timeout", 300_000),
        packageManager: stringFlag(parsed.flags, "package-manager") ?? CLI_DEFAULTS.packageManager,
    }, callFor(io));
    io.out(result.report);
    return result.ok ? 0 : 1;
}
async function validateCommand(parsed, io, fs) {
    const projectDir = requiredPositional(parsed, 0, "projectDir");
    const result = await validateProject(fs, projectDir, callFor(io));
    io.out(result.report);
    return result.ok ? 0 : 1;
}
async function versionCommand(parsed, io, fs) {
    const projectDir = requiredPositional(parsed, 0, "projectDir");
    const version = requiredPositional(parsed, 1, "version");
    try {
        const result = await bumpVersion(fs, { projectDir, version, minAppVersion: stringFlag(parsed.flags, "min-app-version") }, callFor(io));
        const gate = compareSemver(result.minAppVersion, "1.13.0") >= 0
            ? "minAppVersion allows declarative settings (getSettingDefinitions)."
            : "minAppVersion < 1.13.0: the settings tab must keep legacy display().";
        io.out([
            `Version bumped to ${result.version} (minAppVersion ${result.minAppVersion}).`,
            ...result.changed.map((line) => `- ${line}`),
            gate,
            "Commit manifest.json, package.json and versions.json together; the release tag must equal the manifest version.",
            "",
        ].join("\n"));
        return 0;
    }
    catch (error) {
        io.err(`version failed: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}
async function deployCommand(parsed, io, fs) {
    const projectDir = requiredPositional(parsed, 0, "projectDir");
    const result = await deployPlugin(fs, {
        projectDir,
        vault: stringFlag(parsed.flags, "vault"),
        pluginId: stringFlag(parsed.flags, "plugin-id"),
        enable: !booleanFlag(parsed.flags, "no-enable", false),
        createVault: !booleanFlag(parsed.flags, "no-create-vault", false),
        dryRun: booleanFlag(parsed.flags, "dry-run", false),
        testVault: stringFlag(parsed.flags, "test-vault") ?? CLI_DEFAULTS.testVault,
        probeActive: !booleanFlag(parsed.flags, "no-probe", false),
        cliCommand: obsidianCliFlag(parsed.flags),
    }, callFor(io));
    io.out(result.report);
    return result.ok ? 0 : 1;
}
async function statusCommand(parsed, io, fs) {
    const result = await statusReport(fs, {
        projectDir: optionalPositional(parsed, 0),
        vault: stringFlag(parsed.flags, "vault"),
        testVault: stringFlag(parsed.flags, "test-vault") ?? CLI_DEFAULTS.testVault,
        cliCommand: obsidianCliFlag(parsed.flags),
    }, callFor(io));
    io.out(result.report);
    return 0;
}
async function reloadCommand(parsed, io, fs) {
    const action = enumFlag(parsed.flags, "action", reloadActionValues(), "reload");
    const result = await reloadLive(fs, {
        projectDir: optionalPositional(parsed, 0),
        pluginId: stringFlag(parsed.flags, "plugin-id"),
        vault: stringFlag(parsed.flags, "vault"),
        action,
        timeoutMs: numberFlag(parsed.flags, "timeout", 30_000),
        cliCommand: obsidianCliFlag(parsed.flags),
    }, callFor(io));
    io.out(result.report);
    return result.ok ? 0 : 1;
}
async function testCommand(parsed, io, fs) {
    const projectDir = requiredPositional(parsed, 0, "projectDir");
    const result = await runSmoke(fs, {
        projectDir,
        bundle: stringFlag(parsed.flags, "bundle"),
        scenario: enumFlag(parsed.flags, "scenario", SMOKE_SCENARIOS, "load"),
        timeoutMs: numberFlag(parsed.flags, "timeout", 15_000),
    }, callFor(io));
    io.out(result.report);
    return result.ok ? 0 : 1;
}
async function e2eCommand(parsed, io, fs) {
    const projectDir = requiredPositional(parsed, 0, "projectDir");
    const action = enumFlag(parsed.flags, "action", E2E_ACTIONS, "init");
    const result = await runE2e(fs, { projectDir, action, overwrite: booleanFlag(parsed.flags, "overwrite", false) }, callFor(io));
    io.out(result.report);
    return result.ok ? 0 : 1;
}
// ---------------------------------------------------------------------------
// install-skill
// ---------------------------------------------------------------------------
function skillSourceDirectory() {
    return fileURLToPath(new URL("../skill/obsidian-plugin-dev/", import.meta.url));
}
function defaultSkillsDirectory() {
    const override = process.env.OBSIDIAN_DEVKIT_SKILLS_DIR;
    if (override !== undefined && override.length > 0)
        return override;
    const dshHome = process.env.DSH_HOME;
    if (dshHome !== undefined && dshHome.length > 0)
        return join(dshHome, "skills");
    return join(homedir(), ".dsh", "skills");
}
function copyDirectorySync(from, to) {
    const written = [];
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
        const source = join(from, entry.name);
        const target = join(to, entry.name);
        if (entry.isDirectory()) {
            written.push(...copyDirectorySync(source, target));
        }
        else if (entry.isFile()) {
            copyFileSync(source, target);
            written.push(target);
        }
    }
    return written;
}
async function installSkillCommand(parsed, io) {
    const source = skillSourceDirectory();
    if (!existsSync(join(source, "SKILL.md"))) {
        io.err(`Bundled skill not found at ${source}. Install the package or run from a checkout.\n`);
        return 1;
    }
    const skillsDir = resolve(io.cwd, stringFlag(parsed.flags, "skills-dir") ?? defaultSkillsDirectory());
    const target = join(skillsDir, "obsidian-plugin-dev");
    const force = booleanFlag(parsed.flags, "force", false);
    if (existsSync(target)) {
        if (!force) {
            io.err(`Skill already installed at ${target}. Re-run with --force to replace it.\n`);
            return 1;
        }
        rmSync(target, { recursive: true, force: true });
    }
    try {
        const written = copyDirectorySync(source, target);
        io.out(`Installed obsidian-plugin-dev skill (${written.length} files) into ${target}\n`);
        io.out("Start a new agent session (or reload skills) so the catalog picks it up: " +
            "the skill tells the agent when to call `node scripts/devkit.mjs`.\n");
        return 0;
    }
    catch (error) {
        io.err(`install-skill failed: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}
// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------
function commandMap() {
    return {
        scaffold: scaffoldCommand,
        build: buildCommand,
        validate: validateCommand,
        version: versionCommand,
        deploy: deployCommand,
        status: statusCommand,
        reload: reloadCommand,
        test: testCommand,
        e2e: e2eCommand,
        "install-skill": async (parsed, io) => installSkillCommand(parsed, io),
    };
}
function resolveCwd(parsed, fallback) {
    const cwd = stringFlag(parsed.flags, "cwd");
    return cwd === undefined ? fallback : resolve(fallback, cwd);
}
/**
 * Run the CLI in-process (used by the bin entry and by the tests).
 * Returns the process exit code instead of calling `process.exit`.
 */
export async function runCli(argv, io = {}) {
    const merged = { ...defaultIO, ...io };
    try {
        const parsed = parseArgs(argv);
        const cwd = resolveCwd(parsed, merged.cwd);
        const commandName = parsed.positionals[0];
        if (parsed.flags.get("version-switch") === true) {
            merged.out(`${VERSION}\n`);
            return 0;
        }
        if (commandName === undefined) {
            merged.err(USAGE);
            return 2;
        }
        if (parsed.flags.get("help") === true || commandName === "help") {
            const topic = commandName === "help" ? parsed.positionals[1] : commandName;
            merged.out(USAGE);
            if (topic !== undefined && !COMMANDS.includes(topic)) {
                merged.err(`Unknown command "${topic}".\n`);
                return 2;
            }
            return 0;
        }
        const command = commandMap()[commandName];
        if (command === undefined) {
            merged.err(`Unknown command "${commandName}". Available: ${COMMANDS.join(", ")}.\n`);
            return 2;
        }
        const fs = new Fs();
        const commandArgv = {
            positionals: parsed.positionals.slice(1),
            flags: parsed.flags,
        };
        const effective = { ...merged, cwd };
        return await command(commandArgv, effective, fs);
    }
    catch (error) {
        if (error instanceof UsageError) {
            merged.err(`Error: ${error.message}\n`);
            merged.err(`Run "obsidian-devkit help" for usage.\n`);
            return 2;
        }
        merged.err(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}
function isMainModule() {
    const entry = process.argv[1];
    if (entry === undefined)
        return false;
    try {
        return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
    }
    catch {
        return false;
    }
}
if (isMainModule()) {
    void runCli(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    });
}
export { USAGE, VERSION, COMMANDS };
//# sourceMappingURL=commandline.js.map