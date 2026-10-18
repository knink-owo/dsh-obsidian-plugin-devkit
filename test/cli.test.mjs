import assert from "node:assert/strict";
import { test } from "node:test";

import {
  actionArgs,
  activeVaultName,
  cliCandidates,
  cliVersionProblems,
  discoverCli,
  enabledPluginIds,
  pluginDetails,
  runAction,
  runCli,
} from "../lib/cli.js";

/** Scripted replacement for the real subprocess runner. */
function scriptedRun(handler = () => ({})) {
  const calls = [];
  const run = (spec) => {
    calls.push(spec);
    const outcome = handler(spec, calls.length) ?? {};
    return {
      status: "ok",
      commandLine: [spec.command, ...(spec.args ?? [])].join(" "),
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
      ...outcome,
    };
  };
  return { run, calls };
}

const available = {
  appRunning: true,
  available: true,
  command: "obsidian",
  version: "1.14.4",
  detail: "obsidian → 1.14.4",
};

test("cliCandidates prefers OBSIDIAN_CLI then platform install paths", () => {
  const candidates = cliCandidates({ OBSIDIAN_CLI: "C:\\custom\\Obsidian.com", LOCALAPPDATA: "C:\\LA", ProgramFiles: "C:\\PF" }, "win32");
  assert.equal(candidates[0], "C:\\custom\\Obsidian.com");
  assert.ok(candidates.includes("C:\\LA\\Programs\\Obsidian\\Obsidian.com"));
  assert.equal(candidates[candidates.length - 1], "obsidian");
});

test("discoverCli never probes while Obsidian is not running", () => {
  const { run, calls } = scriptedRun();
  const discovery = discoverCli({ command: "obsidian", deps: { run, appRunning: () => false } });
  assert.equal(calls.length, 0);
  assert.equal(discovery.available, false);
  assert.equal(discovery.appRunning, false);
  assert.match(discovery.detail, /未运行/);
});

test("discoverCli returns the version of a working CLI", () => {
  const { run } = scriptedRun(() => ({ stdout: "1.14.4 (installer 1.14.4)" }));
  const discovery = discoverCli({ command: "obsidian", deps: { run, appRunning: () => true } });
  assert.equal(discovery.available, true);
  assert.equal(discovery.version, "1.14.4");
  assert.equal(discovery.command, "obsidian");
});

test("discoverCli degrades to unavailable when every candidate is missing", () => {
  const { run } = scriptedRun(() => ({ status: "missing", stderr: "Command not found" }));
  const discovery = discoverCli({ deps: { run, appRunning: () => true } });
  assert.equal(discovery.available, false);
  assert.equal(discovery.version, null);
  assert.equal(discovery.appRunning, true);
});

test("runCli classifies status instead of trusting the exit code", () => {
  const runOk = scriptedRun(() => ({ stdout: "1.14.4" })).run;
  assert.equal(runCli("obsidian", ["version"], { deps: { run: runOk } }).status, "ok");

  const runSilentError = scriptedRun(() => ({ stdout: 'Error: Plugin "x" not found.' })).run;
  assert.equal(runCli("obsidian", ["plugin", "id=x"], { deps: { run: runSilentError } }).status, "silent-error");

  const runEmpty = scriptedRun(() => ({ stdout: "", stderr: "" })).run;
  assert.equal(runCli("obsidian", ["plugin:reload", "id=x"], { deps: { run: runEmpty } }).status, "empty");

  const runTimeout = scriptedRun(() => ({ status: "timeout" })).run;
  assert.equal(runCli("obsidian", ["version"], { deps: { run: runTimeout } }).status, "timeout");

  const runMissing = scriptedRun(() => ({ status: "missing", stderr: "ENOENT" })).run;
  assert.equal(runCli("obsidian", ["version"], { deps: { run: runMissing } }).status, "unavailable");

  assert.equal(runCli(null, ["version"]).status, "unavailable");
});

test("activeVaultName parses the eval result", () => {
  const { run } = scriptedRun(() => ({ stdout: "=> all-in-one" }));
  assert.equal(activeVaultName(available, { deps: { run } }), "all-in-one");
  assert.equal(activeVaultName({ ...available, available: false }), null);
});

test("enabledPluginIds parses JSON output", () => {
  const { run } = scriptedRun(() => ({ stdout: '[{"id":"dataview"},{"id":"realclaudian"}]' }));
  assert.deepEqual(enabledPluginIds(available, { deps: { run } }), ["dataview", "realclaudian"]);
});

test("pluginDetails parses tab-separated key/value output", () => {
  const { run } = scriptedRun(() => ({
    stdout: "id\trealclaudian\nname\tReal Claudian\nversion\t1.2.3\nenabled\tfalse",
  }));
  const parsed = pluginDetails(available, "realclaudian", { deps: { run } });
  assert.equal(parsed.error, null);
  assert.equal(parsed.details.id, "realclaudian");
  assert.equal(parsed.details.version, "1.2.3");
  assert.equal(parsed.details.enabled, false);
});

test("pluginDetails explains an undiscovered plugin", () => {
  const { run } = scriptedRun(() => ({ stdout: 'Error: Plugin "__x__" not found. Use "plugins" to list available plugins.' }));
  const parsed = pluginDetails(available, "__x__", { deps: { run } });
  assert.equal(parsed.details, null);
  assert.match(parsed.error, /未被 Obsidian 发现/);
});

test("actionArgs builds official command lines, with optional vault scope", () => {
  assert.deepEqual(actionArgs("reload", "demo"), ["plugin:reload", "id=demo"]);
  assert.deepEqual(actionArgs("enable", "demo", "All-In-One"), ["plugin:enable", "id=demo", "vault=All-In-One"]);
  assert.deepEqual(actionArgs("disable", "demo"), ["plugin:disable", "id=demo"]);
  assert.deepEqual(actionArgs("rescan", "demo"), ["eval", "code=app.plugins.loadManifests()"]);
});

test("runAction sends the action through the resolved CLI command", () => {
  const { run, calls } = scriptedRun(() => ({ stdout: "ok" }));
  const call = runAction(available, "reload", "demo", "vault-x", { deps: { run } });
  assert.equal(call.status, "ok");
  assert.equal(calls[0].command, "obsidian");
  assert.deepEqual(calls[0].args, ["plugin:reload", "id=demo", "vault=vault-x"]);
});

test("cliVersionProblems flags CLI versions below 1.12.4", () => {
  assert.equal(cliVersionProblems({ ...available, version: "1.14.4" }).length, 0);
  assert.equal(cliVersionProblems({ ...available, version: "1.11.0" }).length, 1);
  assert.equal(cliVersionProblems({ ...available, available: false, version: null }).length, 0);
});
