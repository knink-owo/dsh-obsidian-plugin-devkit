import { isSemver } from "./naming.js";
import { joinPath, readJsonFile } from "./manifest.js";
function detectIndent(text) {
    const match = text.match(/^([ \t]+)"/m);
    return match?.[1] ?? "\t";
}
export async function bumpVersion(fs, options, call) {
    if (!isSemver(options.version)) {
        throw new Error(`Invalid version "${options.version}": expected semver such as 1.2.3.`);
    }
    if (options.minAppVersion !== undefined && !isSemver(options.minAppVersion)) {
        throw new Error(`Invalid minAppVersion "${options.minAppVersion}": expected semver such as 1.13.0.`);
    }
    const manifestRead = await readJsonFile(fs, joinPath(options.projectDir, "manifest.json"), call);
    if (manifestRead.value === null || typeof manifestRead.value !== "object") {
        throw new Error("manifest.json is missing or not valid JSON; cannot bump the version.");
    }
    const manifest = manifestRead.value;
    const packageRead = await readJsonFile(fs, joinPath(options.projectDir, "package.json"), call);
    const versionsRead = await readJsonFile(fs, joinPath(options.projectDir, "versions.json"), call);
    const manifestText = await fs.readText(joinPath(options.projectDir, "manifest.json"), call.workspaceRoot);
    const changed = [];
    manifest.version = options.version;
    if (options.minAppVersion !== undefined) {
        manifest.minAppVersion = options.minAppVersion;
    }
    await fs.writeJson(joinPath(options.projectDir, "manifest.json"), manifest, detectIndent(manifestText), call.policy, call.signal, call.workspaceRoot);
    changed.push(`manifest.json → ${options.version}`);
    if (packageRead.value !== null && typeof packageRead.value === "object") {
        const packageJson = packageRead.value;
        if (packageJson.version !== options.version) {
            packageJson.version = options.version;
            const packageText = await fs.readText(joinPath(options.projectDir, "package.json"), call.workspaceRoot);
            await fs.writeJson(joinPath(options.projectDir, "package.json"), packageJson, detectIndent(packageText), call.policy, call.signal, call.workspaceRoot);
            changed.push(`package.json → ${options.version}`);
        }
    }
    if (versionsRead.value !== null && typeof versionsRead.value === "object") {
        const versions = versionsRead.value;
        if (versions[options.version] !== manifest.minAppVersion) {
            versions[options.version] = manifest.minAppVersion;
            const versionsText = await fs.readText(joinPath(options.projectDir, "versions.json"), call.workspaceRoot);
            await fs.writeJson(joinPath(options.projectDir, "versions.json"), versions, detectIndent(versionsText), call.policy, call.signal, call.workspaceRoot);
            changed.push(`versions.json[${options.version}] → ${manifest.minAppVersion}`);
        }
    }
    return { version: options.version, minAppVersion: manifest.minAppVersion, changed };
}
//# sourceMappingURL=version.js.map