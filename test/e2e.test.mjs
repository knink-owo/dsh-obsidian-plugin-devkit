import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Fs } from "../lib/fs.js";
import { detectCommandId, mergeGitignore, mergePackageJson, runE2e } from "../lib/e2e.js";

const fs = new Fs();
const root = () => mkdtempSync(join(tmpdir(), "devkit-e2e-"));

const ENTRY = `import { Plugin } from "obsidian";
export default class DemoPlugin extends Plugin {
  async onload() {
    this.addCommand({ id: "open-modal", name: "Open modal", callback() {} });
  }
}
`;

const OK_BUNDLE = `const { Plugin } = require("obsidian");
class DemoPlugin extends Plugin {
  async onload() {
    this.addCommand({ id: "open-modal", name: "Open modal", callback() {} });
  }
}
module.exports = DemoPlugin;
`;

function makeProject(dir, { bundle = OK_BUNDLE, manifest = {} } = {}) {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(
      {
        id: "demo-plugin",
        name: "Demo Plugin",
        version: "1.0.0",
        minAppVersion: "1.13.0",
        description: "Does demo things.",
        author: "demo",
        ...manifest,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "demo-plugin",
        version: "1.0.0",
        scripts: { build: "node esbuild.config.mjs production" },
        devDependencies: { esbuild: "0.25.5" },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(dir, "src", "main.ts"), ENTRY);
  if (bundle !== null) writeFileSync(join(dir, "main.js"), bundle);
  return dir;
}

async function e2e(projectDir, options = {}) {
  return runE2e(fs, { projectDir, ...options }, {});
}

test("detectCommandId reads the first addCommand id and tolerates source without one", () => {
  assert.equal(detectCommandId(ENTRY), "open-modal");
  assert.equal(detectCommandId('this.addCommand({\n\tid: "insert-timestamp",\n});'), "insert-timestamp");
  assert.equal(detectCommandId("export default class X {}"), null);
  assert.equal(detectCommandId(null), null);
});

test("mergePackageJson adds missing e2e deps and the test:e2e script without overwriting", () => {
  const original = JSON.stringify(
    { scripts: { build: "tsc" }, devDependencies: { mocha: "^99.0.0" } },
    null,
    2,
  );
  const merged = mergePackageJson(original);
  assert.equal(merged.error, null);
  assert.equal(merged.changed, true);
  const value = JSON.parse(merged.text);
  assert.equal(value.devDependencies.mocha, "^99.0.0", "existing version must win");
  assert.equal(value.devDependencies["wdio-obsidian-service"], "^3.3.0");
  assert.equal(value.scripts.build, "tsc");
  assert.equal(value.scripts["test:e2e"], "wdio run ./wdio.conf.mts");
  // Second merge is a no-op.
  assert.equal(mergePackageJson(merged.text).changed, false);
});

test("mergePackageJson reports invalid JSON instead of clobbering it", () => {
  const merged = mergePackageJson("{not json");
  assert.equal(merged.changed, false);
  assert.match(merged.error, /not valid JSON/);
});

test("mergeGitignore appends .obsidian-cache/ once", () => {
  const first = mergeGitignore("node_modules/\n");
  assert.equal(first.changed, true);
  assert.match(first.text, /node_modules\//);
  assert.match(first.text, /\.obsidian-cache\//);
  const second = mergeGitignore(first.text);
  assert.equal(second.changed, false);
  const fromNull = mergeGitignore(null);
  assert.match(fromNull.text, /\.obsidian-cache\//);
});

test("e2e init writes the harness, merges package.json and is idempotent", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "demo"));
    const result = await e2e(project);
    assert.equal(result.ok, true, result.report);
    assert.match(result.report, /PASS/);

    for (const file of [
      "wdio.conf.mts",
      "e2e/specs/plugin.e2e.ts",
      "e2e/tsconfig.json",
      "e2e/README.md",
      "e2e/vaults/simple/.obsidian/app.json",
      "e2e/vaults/simple/Welcome.md",
    ]) {
      assert.ok(existsSync(join(project, file)), `expected ${file}`);
    }

    const config = readFileSync(join(project, "wdio.conf.mts"), "utf8");
    assert.match(config, /wdio-obsidian-service|services: \["obsidian"\]/);
    assert.match(config, /vault: "e2e\/vaults\/simple"/);
    assert.match(config, /\.obsidian-cache/);

    const spec = readFileSync(join(project, "e2e/specs/plugin.e2e.ts"), "utf8");
    assert.match(spec, /demo-plugin/);
    assert.match(spec, /demo-plugin:open-modal/);

    const pkg = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
    assert.equal(pkg.devDependencies["wdio-obsidian-service"], "^3.3.0");
    assert.equal(pkg.devDependencies.esbuild, "0.25.5");
    assert.equal(pkg.scripts["test:e2e"], "wdio run ./wdio.conf.mts");

    assert.match(readFileSync(join(project, ".gitignore"), "utf8"), /\.obsidian-cache\//);

    const again = await e2e(project);
    assert.equal(again.ok, true, again.report);
    assert.ok(again.writes.every((write) => write.action === "unchanged" || write.action === "written"));
    assert.match(again.report, /0 个冲突/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("e2e init reports conflicting files unless overwrite is true", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "demo"));
    writeFileSync(join(project, "wdio.conf.mts"), "// hand-written config\n");

    const blocked = await e2e(project);
    assert.equal(blocked.ok, false);
    assert.match(blocked.report, /wdio\.conf\.mts/);
    assert.equal(readFileSync(join(project, "wdio.conf.mts"), "utf8"), "// hand-written config\n");

    const forced = await e2e(project, { overwrite: true });
    assert.equal(forced.ok, true, forced.report);
    assert.match(readFileSync(join(project, "wdio.conf.mts"), "utf8"), /services: \["obsidian"\]/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("e2e status reports the missing pieces and passes once deps are installed", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "demo"));
    const before = await e2e(project, { action: "status" });
    assert.equal(before.ok, false);
    assert.match(before.report, /FAIL/);
    assert.match(before.report, /init/);

    const init = await e2e(project);
    assert.equal(init.ok, true, init.report);

    const missingDeps = await e2e(project, { action: "status" });
    assert.equal(missingDeps.ok, false);
    assert.match(missingDeps.report, /node_modules\/wdio-obsidian-service/);
    assert.match(missingDeps.report, /pnpm install/);

    mkdirSync(join(project, "node_modules", "wdio-obsidian-service"), { recursive: true });
    const ready = await e2e(project, { action: "status" });
    assert.equal(ready.ok, true, ready.report);
    assert.match(ready.report, /PASS/);
    assert.match(ready.report, /test:e2e/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("e2e init refuses a project without manifest.json", async () => {
  const room = root();
  try {
    const dir = join(room, "empty");
    mkdirSync(dir, { recursive: true });
    const result = await e2e(dir);
    assert.equal(result.ok, false);
    assert.match(result.report, /manifest\.json/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});
