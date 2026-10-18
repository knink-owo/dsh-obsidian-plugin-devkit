import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Fs } from "../lib/fs.js";
import { statusReport } from "../lib/status.js";

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

function makeVault(dir) {
  mkdirSync(join(dir, ".obsidian"), { recursive: true });
  return dir;
}

function makeProject(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      id: "demo-plugin",
      name: "Demo Plugin",
      version: "1.0.0",
      minAppVersion: "1.13.0",
      description: "Demo.",
      author: "demo",
    }),
  );
  writeFileSync(join(dir, "main.js"), "module.exports = {};");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "demo-plugin", version: "1.0.0" }));
  return dir;
}

test("statusReport audits the environment and degrades the CLI section honestly", async () => {
  const room = mkdtempSync(join(tmpdir(), "devkit-status-"));
  try {
    const report = await statusReport(
      fs,
      { testVault: "dev-vault", deps: { discovery: unavailable, toolVersion: () => null } },
      { workspaceRoot: room },
    );
    assert.match(report.report, /Obsidian 插件开发环境体检/);
    assert.match(report.report, /CLI 不可用/);
    assert.match(report.report, /已注册 vault/);
    assert.match(report.report, /传入 projectDir/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("statusReport includes project and deployment state for a project", async () => {
  const room = mkdtempSync(join(tmpdir(), "devkit-status-"));
  try {
    const project = makeProject(join(room, "project"));
    const vault = makeVault(join(room, "vault"));
    const report = await statusReport(
      fs,
      {
        projectDir: project,
        vault,
        testVault: "dev-vault",
        deps: { discovery: unavailable, toolVersion: () => null },
      },
      { workspaceRoot: room },
    );
    assert.match(report.report, /项目/);
    assert.match(report.report, /demo-plugin/);
    assert.match(report.report, /部署位置/);
    assert.match(report.report, /尚未出现在任何已检查的 vault/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});

test("statusReport reports live state when the CLI is available", async () => {
  const room = mkdtempSync(join(tmpdir(), "devkit-status-"));
  try {
    const project = makeProject(join(room, "project"));
    const vault = makeVault(join(room, "vault"));
    const report = await statusReport(
      fs,
      {
        projectDir: project,
        vault,
        testVault: "dev-vault",
        deps: {
          discovery: available,
          toolVersion: () => null,
          activeVault: () => "all-in-one",
          enabledPlugins: () => ["demo-plugin"],
          details: () => ({
            details: { id: "demo-plugin", enabled: true, version: "1.0.0", name: "Demo Plugin" },
            error: null,
          }),
        },
      },
      { workspaceRoot: room },
    );
    assert.match(report.report, /运行中状态（只读）/);
    assert.match(report.report, /已启用/);
    assert.match(report.report, /前台 vault：all-in-one/);
    assert.match(report.report, /包含该插件/);
  } finally {
    rmSync(room, { recursive: true, force: true });
  }
});
