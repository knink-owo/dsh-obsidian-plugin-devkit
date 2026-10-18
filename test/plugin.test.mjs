import { test } from "node:test";
import assert from "node:assert/strict";

import { apply, DEFAULT_CONFIG, inject, name, textOutput } from "../lib/index.js";

test("plugin exposes the expected cordis identity", () => {
  assert.equal(name, "obsidian-plugin-devkit");
  assert.deepEqual(inject, ["tools", "fs"]);
  assert.equal(DEFAULT_CONFIG.defaultMinAppVersion, "1.13.0");
});

test("apply registers exactly the four M1 tools", () => {
  const registered = [];
  apply({ tools: { register: (tool) => registered.push(tool) } });
  assert.deepEqual(
    registered.map((tool) => tool.name).sort(),
    [
      "obsidian_devkit_build",
      "obsidian_devkit_scaffold",
      "obsidian_devkit_validate",
      "obsidian_devkit_version",
    ],
  );
  for (const tool of registered) {
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length > 60, `${tool.name} description is too short`);
    assert.equal(typeof tool.execute, "function");
    assert.equal(typeof tool.parameters, "object");
    assert.ok(Object.keys(tool.parameters).length > 0);
  }
});

test("text output renders a single text block", () => {
  assert.deepEqual(textOutput.render({}, "hello"), [{ type: "text", text: "hello" }]);
  assert.deepEqual(textOutput.schema, { type: "string" });
});

test("tools reject empty required string arguments with a readable message", async () => {
  const registered = [];
  apply({ tools: { register: (tool) => registered.push(tool) } });
  const byName = Object.fromEntries(registered.map((tool) => [tool.name, tool]));
  assert.match(
    await byName.obsidian_devkit_scaffold.execute({ targetDir: "x" }, undefined),
    /requires non-empty id and name/i,
  );
  assert.match(
    await byName.obsidian_devkit_build.execute({ projectDir: "" }, undefined),
    /requires a non-empty projectDir/i,
  );
  assert.match(
    await byName.obsidian_devkit_version.execute({ projectDir: "x" }, undefined),
    /requires non-empty projectDir and version/i,
  );
});

test("validate fails softly on a missing directory", async () => {
  const registered = [];
  apply({ tools: { register: (tool) => registered.push(tool) } });
  const tool = registered.find((candidate) => candidate.name === "obsidian_devkit_validate");
  const report = await tool.execute({ projectDir: ".devkit/does-not-exist" }, undefined);
  assert.match(report, /does not exist|not found|Missing|FAIL/i);
});
