/**
 * Project inspection: reads a plugin project from disk and evaluates it against
 * the rules the community review applies. `validate` and `build` share it so the
 * two tools can never disagree about what "a valid project" means.
 *
 * The checks are split into three levels:
 *
 *  - problems: the project is broken or would be rejected (must fix);
 *  - warnings: works today, will bite during review or release (should fix);
 *  - notes: facts worth reporting (build state, entry point, settings style).
 */
import { basename } from "node:path";
import { compareSemver, descriptionProblems, isSemver, namingWarnings, pluginIdProblems, pluginNameProblems, } from "./naming.js";
export function joinPath(base, child) {
    return `${base.replace(/[\\/]+$/, "")}/${child}`;
}
export async function readJsonFile(fs, path, call) {
    try {
        const text = (await fs.readText(path, call.workspaceRoot)).replace(/^\uFEFF/, "");
        return { value: JSON.parse(text), error: null };
    }
    catch (error) {
        return { value: null, error: error instanceof Error ? error.message : String(error) };
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringField(manifest, field) {
    const value = manifest[field];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
/** Locate the TypeScript entry point using the usual layouts and the esbuild config. */
async function detectEntry(fs, projectDir, call) {
    for (const candidate of ["src/main.ts", "src/main.tsx", "main.ts"]) {
        if (await fs.exists(joinPath(projectDir, candidate), call.workspaceRoot)) {
            return { entry: candidate, esbuildConfig: await readEsbuildConfig(fs, projectDir, call) };
        }
    }
    const config = await readEsbuildConfig(fs, projectDir, call);
    const match = config?.match(/entryPoints\s*:\s*\[\s*['"]([^'"]+)['"]/);
    return { entry: match?.[1] ?? null, esbuildConfig: config };
}
async function readEsbuildConfig(fs, projectDir, call) {
    for (const candidate of ["esbuild.config.mjs", "esbuild.config.js", "esbuild.config.ts"]) {
        try {
            return await fs.readText(joinPath(projectDir, candidate), call.workspaceRoot);
        }
        catch {
            /* try the next candidate */
        }
    }
    return null;
}
/** Public alias used by the build tool to find entry/outfile configuration. */
export { readEsbuildConfig as readBuildConfig };
/** Locate the built bundle: `outfile` from the build config, else `main.js`. */
async function detectBundle(fs, projectDir, esbuildConfig, call) {
    const outfileMatch = esbuildConfig?.match(/outfile\s*:\s*['"]([^'"]+)['"]/);
    const candidates = outfileMatch?.[1]
        ? [outfileMatch[1]]
        : ["main.js", "dist/main.js"];
    for (const candidate of candidates) {
        const path = joinPath(projectDir, candidate);
        try {
            const text = await fs.readText(path, call.workspaceRoot);
            return { bundle: candidate, text, size: Buffer.byteLength(text, "utf8") };
        }
        catch {
            /* bundle not built yet */
        }
    }
    return { bundle: null, text: null, size: null };
}
async function detectSettingsStyle(fs, projectDir, call) {
    for (const candidate of ["src/settings.ts", "src/settings.tsx"]) {
        try {
            const text = await fs.readText(joinPath(projectDir, candidate), call.workspaceRoot);
            if (text.includes("getSettingDefinitions"))
                return { style: "declarative", text };
            if (/display\s*\(\s*\)/.test(text))
                return { style: "legacy", text };
            return { style: "unknown", text };
        }
        catch {
            /* try the next candidate */
        }
    }
    return { style: "unknown", text: null };
}
function validateManifestFields(manifest, problems, warnings) {
    const required = ["id", "name", "version", "minAppVersion", "description", "author"];
    for (const field of required) {
        const value = stringField(manifest, field);
        if (value === null)
            problems.push(`manifest.json: "${field}" is required and must be a non-empty string.`);
    }
    if (typeof manifest.isDesktopOnly !== "boolean") {
        problems.push('manifest.json: "isDesktopOnly" is required and must be true or false.');
    }
    if (typeof manifest.id === "string")
        problems.push(...pluginIdProblems(manifest.id));
    if (typeof manifest.name === "string")
        problems.push(...pluginNameProblems(manifest.name));
    if (typeof manifest.description === "string")
        problems.push(...descriptionProblems(manifest.description));
    const version = stringField(manifest, "version");
    if (version !== null && !isSemver(version)) {
        problems.push(`manifest.json: version "${version}" is not valid semver.`);
    }
    const minAppVersion = stringField(manifest, "minAppVersion");
    if (minAppVersion !== null && !isSemver(minAppVersion)) {
        problems.push(`manifest.json: minAppVersion "${minAppVersion}" is not valid semver.`);
    }
    if (manifest.authorUrl !== undefined) {
        if (typeof manifest.authorUrl !== "string" || !/^https?:\/\//.test(manifest.authorUrl)) {
            warnings.push('manifest.json: "authorUrl" should be an absolute http(s) URL; omit it if you do not have one.');
        }
    }
    if (manifest.fundingUrl !== undefined) {
        const urls = typeof manifest.fundingUrl === "string"
            ? [manifest.fundingUrl]
            : isRecord(manifest.fundingUrl)
                ? Object.values(manifest.fundingUrl)
                : [];
        for (const url of urls) {
            if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
                warnings.push('manifest.json: "fundingUrl" values must be absolute http(s) donation links.');
            }
        }
    }
}
function checkBundle(text, warnings, problems) {
    if (!/module\.exports|exports\.[A-Za-z_$]/.test(text)) {
        problems.push("main.js does not look like a CommonJS bundle. Obsidian loads plugins with require(); configure esbuild with format: 'cjs'.");
    }
    if (/^\s*(?:import|export)\s/m.test(text)) {
        problems.push("main.js contains ES module syntax; Obsidian's loader evaluates the bundle as CommonJS and will fail.");
    }
    if (!/require\(["']obsidian["']\)/.test(text)) {
        warnings.push('main.js does not require "obsidian"; verify that the plugin extends Plugin and that esbuild keeps "obsidian" external.');
    }
}
/** Read everything the checks need. Missing files are recorded as problems, not thrown. */
export async function inspectProject(fs, projectDir, call) {
    const absoluteDir = await fs.resolve(projectDir, call.workspaceRoot);
    const inspection = {
        projectDir,
        absoluteDir,
        manifest: null,
        packageJson: null,
        versions: null,
        entry: null,
        bundle: null,
        bundleSize: null,
        bundleText: null,
        settingsStyle: "unknown",
        hasTsconfig: false,
        hasEslint: false,
        problems: [],
        warnings: [],
        notes: [],
    };
    if (!(await fs.isDirectory(projectDir, call.workspaceRoot))) {
        inspection.problems.push(`Project directory not found: ${projectDir}`);
        return inspection;
    }
    const manifestRead = await readJsonFile(fs, joinPath(projectDir, "manifest.json"), call);
    if (!isRecord(manifestRead.value)) {
        inspection.problems.push(`manifest.json is missing or not valid JSON${manifestRead.error ? ` (${manifestRead.error})` : ""}.`);
    }
    else {
        inspection.manifest = manifestRead.value;
        const problems = [];
        const warnings = [];
        validateManifestFields(manifestRead.value, problems, warnings);
        inspection.problems.push(...problems);
        inspection.warnings.push(...warnings);
        inspection.warnings.push(...namingWarnings({
            author: stringField(manifestRead.value, "author") ?? undefined,
            version: stringField(manifestRead.value, "version") ?? undefined,
            description: stringField(manifestRead.value, "description") ?? undefined,
        }));
        const id = stringField(manifestRead.value, "id");
        if (id !== null && basename(absoluteDir) !== id) {
            inspection.notes.push(`Folder name "${basename(absoluteDir)}" differs from manifest id "${id}"; when installed the folder must be named after the id.`);
        }
    }
    const packageRead = await readJsonFile(fs, joinPath(projectDir, "package.json"), call);
    if (!isRecord(packageRead.value)) {
        inspection.problems.push(`package.json is missing or not valid JSON${packageRead.error ? ` (${packageRead.error})` : ""}.`);
    }
    else {
        inspection.packageJson = packageRead.value;
        const manifest = inspection.manifest;
        if (manifest !== null) {
            if (typeof packageRead.value.name !== "string" || packageRead.value.name !== manifest.id) {
                inspection.warnings.push(`package.json name (${String(packageRead.value.name)}) should equal manifest id (${manifest.id}).`);
            }
            if (typeof packageRead.value.version !== "string" || packageRead.value.version !== manifest.version) {
                inspection.problems.push(`package.json version (${String(packageRead.value.version)}) must equal manifest version (${manifest.version}); run the version tool to sync them.`);
            }
        }
    }
    const versionsRead = await readJsonFile(fs, joinPath(projectDir, "versions.json"), call);
    if (!isRecord(versionsRead.value)) {
        inspection.warnings.push("versions.json is missing; the release workflow expects a version → minAppVersion map.");
    }
    else {
        inspection.versions = versionsRead.value;
        const manifest = inspection.manifest;
        if (manifest !== null && isSemver(manifest.version)) {
            const recorded = inspection.versions[manifest.version];
            if (recorded === undefined) {
                inspection.notes.push(`versions.json has no entry for ${manifest.version}; it is added when the version is released.`);
            }
            else if (recorded !== manifest.minAppVersion) {
                inspection.problems.push(`versions.json maps ${manifest.version} to ${recorded}, but manifest minAppVersion is ${manifest.minAppVersion}.`);
            }
        }
    }
    inspection.hasTsconfig = await fs.exists(joinPath(projectDir, "tsconfig.json"), call.workspaceRoot);
    if (!inspection.hasTsconfig) {
        inspection.warnings.push("tsconfig.json is missing; the build will not type-check.");
    }
    inspection.hasEslint =
        (await fs.exists(joinPath(projectDir, "eslint.config.mts"), call.workspaceRoot)) ||
            (await fs.exists(joinPath(projectDir, "eslint.config.js"), call.workspaceRoot)) ||
            (await fs.exists(joinPath(projectDir, "eslint.config.mjs"), call.workspaceRoot));
    const entryInfo = await detectEntry(fs, projectDir, call);
    inspection.entry = entryInfo.entry;
    if (inspection.entry === null) {
        inspection.problems.push("Could not find a TypeScript entry point (src/main.ts or main.ts) nor an esbuild entryPoints option.");
    }
    const styleInfo = await detectSettingsStyle(fs, projectDir, call);
    inspection.settingsStyle = styleInfo.style;
    const minAppVersion = inspection.manifest?.minAppVersion;
    if (minAppVersion !== undefined && isSemver(minAppVersion)) {
        if (styleInfo.style === "declarative" && compareSemver(minAppVersion, "1.13.0") < 0) {
            inspection.problems.push(`Declarative settings (getSettingDefinitions) require minAppVersion >= 1.13.0, but manifest declares ${minAppVersion}.`);
        }
        if (styleInfo.style === "legacy" && compareSemver(minAppVersion, "1.13.0") >= 0) {
            inspection.notes.push("Settings use the legacy display() API although minAppVersion allows the 1.13.0+ declarative API.");
        }
    }
    const bundleInfo = await detectBundle(fs, projectDir, entryInfo.esbuildConfig, call);
    inspection.bundle = bundleInfo.bundle;
    inspection.bundleText = bundleInfo.text;
    inspection.bundleSize = bundleInfo.size;
    if (bundleInfo.text !== null) {
        checkBundle(bundleInfo.text, inspection.warnings, inspection.problems);
        if (inspection.bundleSize !== null && inspection.bundleSize > 2 * 1024 * 1024) {
            inspection.warnings.push(`main.js is ${(inspection.bundleSize / 1024 / 1024).toFixed(1)} MB; large bundles slow Obsidian startup. Consider deferring optional code.`);
        }
        if (inspection.bundleSize !== null && inspection.bundleSize > 0) {
            try {
                const gitignore = await fs.readText(joinPath(projectDir, ".gitignore"), call.workspaceRoot);
                if (!/main\.js/.test(gitignore)) {
                    inspection.warnings.push(".gitignore does not ignore build artifacts (main.js).");
                }
            }
            catch {
                inspection.notes.push("No .gitignore found; build artifacts may end up in git.");
            }
        }
    }
    else {
        inspection.notes.push("No built main.js yet; run the build tool before deploying.");
    }
    return inspection;
}
//# sourceMappingURL=manifest.js.map