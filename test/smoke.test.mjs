import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Fs } from "../lib/fs.js";
import { runSmoke } from "../lib/smoke.js";

const fs = new Fs();
const root = () => mkdtempSync(join(tmpdir(), "devkit-smoke-"));

function makeProject(dir, bundle) {
  mkdirSync(dir, { recursive: true });
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
      },
      null,
      2,
    ),
  );
  if (bundle !== null) writeFileSync(join(dir, "main.js"), bundle);
  return dir;
}

const OK_BUNDLE = `const { Plugin } = require("obsidian");
class DemoPlugin extends Plugin {
  async onload() {
    this.addCommand({ id: "demo", name: "Demo", callback() {} });
  }
}
module.exports = DemoPlugin;
`;

async function smoke(projectDir, options = {}) {
  return runSmoke(fs, { projectDir, ...options }, {});
}

test("runSmoke passes a CommonJS plugin bundle and reports the checks", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "demo"), OK_BUNDLE);
    const result = await smoke(project);
    assert.equal(result.ok, true);
    assert.ok(result.checks.length >= 4);
    assert.ok(result.checks.every((check) => check.ok));
    assert.match(result.report, /PASS/);
    assert.match(result.report, /CommonJS/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("runSmoke instantiates the plugin and awaits onload in the onload scenario", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "demo"), OK_BUNDLE);
    const result = await smoke(project, { scenario: "onload" });
    assert.equal(result.ok, true);
    assert.ok(result.checks.some((check) => check.name === "onload()" && check.ok));
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("runSmoke runs onunload in the unload scenario", async () => {
  const room = root();
  try {
    const bundle = `const { Plugin } = require("obsidian");
class DemoPlugin extends Plugin {
  async onload() {}
  onunload() { this.unloaded = true; }
}
module.exports = DemoPlugin;
`;
    const project = makeProject(join(room, "demo"), bundle);
    const result = await smoke(project, { scenario: "unload" });
    assert.equal(result.ok, true);
    assert.equal(result.scenario, "unload");
    assert.ok(result.checks.some((check) => check.name === "onunload()" && check.ok));
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("runSmoke fails when the build artifact is missing", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "demo"), null);
    const result = await smoke(project);
    assert.equal(result.ok, false);
    assert.match(result.report, /构建产物/);
    assert.match(result.report, /obsidian-devkit build/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("runSmoke reports ES module output as not loadable", async () => {
  const room = root();
  try {
    const project = makeProject(
      join(room, "demo"),
      `import { Plugin } from "obsidian";\nexport default class DemoPlugin extends Plugin {}\n`,
    );
    const result = await smoke(project);
    assert.equal(result.ok, false);
    assert.match(result.report, /模块执行/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("runSmoke fails when the exported class does not extend Plugin", async () => {
  const room = root();
  try {
    const project = makeProject(
      join(room, "demo"),
      `class NotAPlugin {}\nmodule.exports = NotAPlugin;\n`,
    );
    const result = await smoke(project);
    assert.equal(result.ok, false);
    assert.ok(result.checks.some((check) => check.name === "继承 Plugin" && check.ok === false));
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("runSmoke fails when the bundle requires a module the sandbox does not provide", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "demo"), `require("left-pad");\nmodule.exports = {};\n`);
    const result = await smoke(project);
    assert.equal(result.ok, false);
    assert.match(result.report, /left-pad/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("runSmoke reports a throwing onload", async () => {
  const room = root();
  try {
    const bundle = `const { Plugin } = require("obsidian");
class DemoPlugin extends Plugin {
  async onload() { throw new Error("boom while loading"); }
}
module.exports = DemoPlugin;
`;
    const project = makeProject(join(room, "demo"), bundle);
    const result = await smoke(project, { scenario: "onload" });
    assert.equal(result.ok, false);
    assert.match(result.report, /boom while loading/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("runSmoke reports a hanging onload as a timeout", async () => {
  const room = root();
  try {
    const bundle = `const { Plugin } = require("obsidian");
class DemoPlugin extends Plugin {
  async onload() { await new Promise(() => {}); }
}
module.exports = DemoPlugin;
`;
    const project = makeProject(join(room, "demo"), bundle);
    const result = await smoke(project, { scenario: "onload", timeoutMs: 50 });
    assert.equal(result.ok, false);
    assert.match(result.report, /timed out|超时/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("runSmoke resolves a bundle path override", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "demo"), null);
    writeFileSync(join(project, "custom.js"), OK_BUNDLE);
    const result = await smoke(project, { bundle: "custom.js" });
    assert.equal(result.ok, true);
    assert.match(result.report, /custom\.js/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});
