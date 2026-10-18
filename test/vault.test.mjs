import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Fs } from "../lib/fs.js";
import {
  obsidianConfigDir,
  parseVaultRegistry,
  resolveVault,
  vaultName,
} from "../lib/vault.js";

const fs = new Fs();

function tempRoom() {
  return mkdtempSync(join(tmpdir(), "devkit-vault-"));
}

function makeVault(root, name) {
  const dir = join(root, name);
  mkdirSync(join(dir, ".obsidian"), { recursive: true });
  return dir;
}

function makeDir(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("obsidianConfigDir resolves the per-user config directory", () => {
  const normalized = (value) => value.replace(/\\/g, "/");
  assert.equal(normalized(obsidianConfigDir({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "win32")), "C:/Users/me/AppData/Roaming/obsidian");
  assert.equal(obsidianConfigDir({}, "win32"), null);
  assert.equal(obsidianConfigDir({ HOME: "/home/me" }, "darwin"), "/home/me/Library/Application Support/obsidian");
  assert.equal(obsidianConfigDir({ XDG_CONFIG_HOME: "/home/me/.config" }, "linux"), "/home/me/.config/obsidian");
});

test("parseVaultRegistry derives names and skips malformed entries", () => {
  const entries = parseVaultRegistry(
    JSON.stringify({
      vaults: {
        abc123: { path: "D:\\Notes\\main", open: true },
        def456: { path: "/home/me/second" },
        broken: { path: 42 },
      },
    }),
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, "main");
  assert.equal(entries[0].open, true);
  assert.equal(entries[1].name, "second");
  assert.deepEqual(parseVaultRegistry("not json"), []);
});

test("resolveVault: default development vault may be created on deploy", async () => {
  const root = tempRoom();
  try {
    const resolution = await resolveVault(
      fs,
      { defaultVault: "dev-vault", create: true, registry: { path: null, entries: [], error: null } },
      { workspaceRoot: root },
    );
    assert.equal(resolution.source, "default");
    assert.equal(resolution.problem, null);
    assert.equal(resolution.exists, false);
    assert.equal(resolution.createOnDeploy, true);
    assert.equal(resolution.path.replace(/\\/g, "/"), join(root, "dev-vault").replace(/\\/g, "/"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveVault: refusing to create when asked not to", async () => {
  const root = tempRoom();
  try {
    const resolution = await resolveVault(
      fs,
      { defaultVault: "dev-vault", create: false, registry: { path: null, entries: [], error: null } },
      { workspaceRoot: root },
    );
    assert.notEqual(resolution.problem, null);
    assert.match(resolution.problem, /不存在|创建/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveVault: an explicit existing vault resolves and is recognised", async () => {
  const root = tempRoom();
  const vault = makeVault(root, "My Vault");
  try {
    const resolution = await resolveVault(
      fs,
      { vault, defaultVault: "dev-vault", create: false, registry: { path: null, entries: [], error: null } },
      { workspaceRoot: root },
    );
    assert.equal(resolution.source, "explicit");
    assert.equal(resolution.isVault, true);
    assert.equal(resolution.problem, null);
    assert.equal(vaultName(resolution.path), "My Vault");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveVault: an explicit directory without .obsidian is not a vault", async () => {
  const root = tempRoom();
  const dir = makeDir(root, "not-a-vault");
  try {
    const resolution = await resolveVault(
      fs,
      { vault: dir, defaultVault: "dev-vault", create: true, registry: { path: null, entries: [], error: null } },
      { workspaceRoot: root },
    );
    assert.equal(resolution.isVault, false);
    assert.notEqual(resolution.problem, null);
    assert.equal(resolution.createOnDeploy, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveVault: a registered vault is found by folder name", async () => {
  const root = tempRoom();
  const vault = makeVault(root, "Registered");
  try {
    const resolution = await resolveVault(
      fs,
      {
        vault: "Registered",
        defaultVault: "dev-vault",
        create: false,
        registry: {
          path: "obsidian.json",
          entries: [{ id: "abc", name: "Registered", path: vault, open: false }],
          error: null,
        },
      },
      { workspaceRoot: root },
    );
    assert.equal(resolution.source, "registry");
    assert.equal(resolution.entry.id, "abc");
    assert.equal(resolution.isVault, true);
    assert.equal(resolution.problem, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
