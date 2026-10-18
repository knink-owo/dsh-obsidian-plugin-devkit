import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Fs } from "../lib/fs.js";
import { reloadLive } from "../lib/reload.js";

const fs = new Fs();

const unavailable = {
  appRunning: false,
  available: false,
  command: null,
  version: null,
  detail: "Obsidian 未运行；为避免 CLI 冷启动拉起应用，未探测 CLI。",
};

const available = {
  appRunning: true,
  available: true,
  command: "obsidian",
  version: "1.14.4",
  detail: "obsidian → 1.14.4",
};

function scriptedRun(handler = () => ({})) {
  const calls = [];
  const run = (spec) => {
    calls.push(spec);
    return {
      status: "ok",
      commandLine: [spec.command, ...(spec.args ?? [])].join(" "),
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 5,
      ...handler(spec),
    };
  };
  return { run, calls };
}

function options(overrides) {
  return { action: "reload", timeoutMs: 5_000, ...overrides };
}

function makeProject(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ id: "demo-plugin", name: "Demo", version: "1.0.0", minAppVersion: "1.13.0", description: "Demo." }),
  );
  writeFileSync(join(dir, "main.js"), "module.exports = {};");
  return dir;
}

test("reloadLive refuses when Obsidian is not running", async () => {
  const result = await reloadLive(fs, options({ pluginId: "demo-plugin", deps: { discovery: unavailable } }), {});
  assert.equal(result.ok, false);
  assert.match(result.report, /Obsidian 未运行/);
});

test("reloadLive refuses when the CLI is unavailable", async () => {
  const discovery = { ...available, available: false, command: null, version: null, detail: "未找到 CLI" };
  const result = await reloadLive(fs, options({ pluginId: "demo-plugin", deps: { discovery } }), {});
  assert.equal(result.ok, false);
  assert.match(result.report, /CLI 不可用/);
});

test("reloadLive requires a plugin id or a resolvable project", async () => {
  const result = await reloadLive(fs, options({ deps: { discovery: available } }), {});
  assert.equal(result.ok, false);
  assert.match(result.report, /需要 pluginId/);
});

test("reloadLive resolves the id from the project manifest and verifies the result", async () => {
  const room = mkdtempSync(join(tmpdir(), "devkit-reload-"));
  try {
    const project = makeProject(join(room, "project"));
    const { run, calls } = scriptedRun(() => ({ stdout: "Reloaded plugin demo-plugin." }));
    const result = await reloadLive(
      fs,
      options({
        projectDir: project,
        deps: {
          discovery: available,
          activeVault: () => "all-in-one",
          run,
          details: () => ({
            details: { id: "demo-plugin", name: "Demo", version: "1.0.0", enabled: true, author: null, description: null, raw: "" },
            error: null,
          }),
        },
      }),
      { workspaceRoot: room },
    );

    assert.equal(result.ok, true);
    assert.equal(result.pluginId, "demo-plugin");
    assert.match(result.report, /PASS/);
    assert.deepEqual(calls[0].args, ["plugin:reload", "id=demo-plugin"]);
    assert.match(result.report, /已启用/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("reloadLive explains an undiscovered plugin from a silent CLI error", async () => {
  const { run } = scriptedRun(() => ({
    stdout: 'Error: Plugin "demo-plugin" not found. Use "plugins" to list available plugins.',
  }));
  const result = await reloadLive(
    fs,
    options({
      pluginId: "demo-plugin",
      deps: {
        discovery: available,
        activeVault: () => "all-in-one",
        run,
        details: () => ({ details: null, error: '插件 "demo-plugin" 未被 Obsidian 发现。' }),
      },
    }),
    {},
  );
  assert.equal(result.ok, false);
  assert.match(result.report, /未被发现/);
  assert.match(result.report, /rescan/);
});

test("reloadLive warns when the target vault is not the frontmost one", async () => {
  const { run } = scriptedRun(() => ({ stdout: "ok" }));
  const result = await reloadLive(
    fs,
    options({
      pluginId: "demo-plugin",
      vault: "other-vault",
      deps: {
        discovery: available,
        activeVault: () => "all-in-one",
        run,
        details: () => ({ details: null, error: "未返回插件信息" }),
      },
    }),
    {},
  );
  assert.match(result.report, /不是当前前台 vault/);
});

test("reloadLive reports a timeout as an explicit outcome", async () => {
  const { run } = scriptedRun(() => ({ status: "timeout", stdout: "", stderr: "" }));
  const result = await reloadLive(
    fs,
    options({
      pluginId: "demo-plugin",
      deps: { discovery: available, activeVault: () => "all-in-one", run, details: () => ({ details: null, error: null }) },
    }),
    {},
  );
  assert.equal(result.ok, false);
  assert.match(result.report, /秒内没有返回/);
});
