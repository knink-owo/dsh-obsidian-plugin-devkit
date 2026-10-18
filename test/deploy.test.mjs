import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { deployPlugin } from "../lib/deploy.js";
import { Fs } from "../lib/fs.js";

const fs = new Fs();
const root = () => mkdtempSync(join(tmpdir(), "devkit-deploy-"));

function makeProject(dir, { bundle = "module.exports = {};\n", styles = "body {}\n", manifest = {} } = {}) {
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
        ...manifest,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "demo-plugin", version: "1.0.0" }, null, 2));
  writeFileSync(join(dir, "main.js"), bundle);
  writeFileSync(join(dir, "styles.css"), styles);
  writeFileSync(join(dir, "versions.json"), JSON.stringify({ "1.0.0": "1.13.0" }, null, 2));
  return dir;
}

function makeVault(dir) {
  mkdirSync(join(dir, ".obsidian"), { recursive: true });
  return dir;
}

function options(overrides) {
  return {
    projectDir: "",
    enable: true,
    createVault: true,
    dryRun: false,
    testVault: "dev-vault",
    probeActive: false,
    ...overrides,
  };
}

test("deployPlugin copies the bundle, merges the enabled list and records a binding", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "project"));
    const vault = makeVault(join(room, "vault"));
    const result = await deployPlugin(
      fs,
      options({ projectDir: project, vault }),
      { workspaceRoot: room },
    );

    assert.equal(result.ok, true);
    assert.equal(result.pluginId, "demo-plugin");
    assert.equal(result.vaultPath, vault);
    assert.deepEqual(
      result.files.map((file) => [file.name, file.action]),
      [
        ["manifest.json", "written"],
        ["main.js", "written"],
        ["styles.css", "written"],
      ],
    );

    const pluginDir = join(vault, ".obsidian", "plugins", "demo-plugin");
    assert.equal(readFileSync(join(pluginDir, "main.js"), "utf8"), "module.exports = {};\n");
    assert.deepEqual(JSON.parse(readFileSync(join(vault, ".obsidian", "community-plugins.json"), "utf8")), [
      "demo-plugin",
    ]);

    const binding = JSON.parse(readFileSync(join(vault, ".dsh", "devkit.json"), "utf8"));
    assert.equal(binding.pluginId, "demo-plugin");
    assert.equal(binding.version, "1.0.0");
    assert.equal(binding.enableRequested, true);
    assert.equal(binding.files.length, 3);
    assert.match(result.report, /PASS/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("deployPlugin keeps unrelated enabled plugins instead of replacing the file", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "project"));
    const vault = makeVault(join(room, "vault"));
    writeFileSync(join(vault, ".obsidian", "community-plugins.json"), JSON.stringify(["other-plugin"], null, 2));

    const result = await deployPlugin(fs, options({ projectDir: project, vault }), { workspaceRoot: room });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(readFileSync(join(vault, ".obsidian", "community-plugins.json"), "utf8")), [
      "other-plugin",
      "demo-plugin",
    ]);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("deployPlugin never touches community-plugins.json when enable is false", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "project"));
    const vault = makeVault(join(room, "vault"));
    writeFileSync(join(vault, ".obsidian", "community-plugins.json"), JSON.stringify(["other-plugin"], null, 2));

    const result = await deployPlugin(
      fs,
      options({ projectDir: project, vault, enable: false }),
      { workspaceRoot: room },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(readFileSync(join(vault, ".obsidian", "community-plugins.json"), "utf8")), [
      "other-plugin",
    ]);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("deployPlugin reports unchanged files on a second identical run", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "project"));
    const vault = makeVault(join(room, "vault"));
    await deployPlugin(fs, options({ projectDir: project, vault }), { workspaceRoot: room });
    const second = await deployPlugin(fs, options({ projectDir: project, vault }), { workspaceRoot: room });
    assert.equal(second.ok, true);
    assert.deepEqual(second.files.map((file) => file.action), ["unchanged", "unchanged", "unchanged"]);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("deployPlugin dryRun reports writes without touching the vault", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "project"));
    const vault = makeVault(join(room, "vault"));
    const result = await deployPlugin(
      fs,
      options({ projectDir: project, vault, dryRun: true }),
      { workspaceRoot: room },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.files.map((file) => file.action), ["would-write", "would-write", "would-write"]);
    assert.equal(existsSync(join(vault, ".obsidian", "plugins", "demo-plugin")), false);
    assert.equal(existsSync(join(vault, ".dsh")), false);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("deployPlugin refuses to deploy without a build artifact", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "project"), { bundle: "" });
    // A zero-byte main.js is still a file; remove it to model "never built".
    rmSync(join(project, "main.js"));
    const vault = makeVault(join(room, "vault"));
    const result = await deployPlugin(fs, options({ projectDir: project, vault }), { workspaceRoot: room });
    assert.equal(result.ok, false);
    assert.match(result.report, /main\.js/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("deployPlugin creates the default development vault on demand", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "project"));
    const result = await deployPlugin(fs, options({ projectDir: project }), { workspaceRoot: room });
    assert.equal(result.ok, true);
    assert.equal(result.vaultPath.replace(/\\/g, "/"), join(room, "dev-vault").replace(/\\/g, "/"));
    assert.equal(existsSync(join(room, "dev-vault", ".obsidian", "plugins", "demo-plugin", "main.js")), true);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("deployPlugin rejects a pluginId that disagrees with the manifest", async () => {
  const room = root();
  try {
    const project = makeProject(join(room, "project"));
    const vault = makeVault(join(room, "vault"));
    const result = await deployPlugin(
      fs,
      options({ projectDir: project, vault, pluginId: "another-id" }),
      { workspaceRoot: room },
    );
    assert.equal(result.ok, false);
    assert.match(result.report, /不一致/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});
