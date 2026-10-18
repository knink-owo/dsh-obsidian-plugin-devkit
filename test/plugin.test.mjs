import { test } from "node:test";
import assert from "node:assert/strict";

import { apply, DEFAULT_CONFIG, inject, name, textOutput } from "../lib/index.js";

test("plugin exposes the expected cordis identity", () => {
  assert.equal(name, "obsidian-plugin-devkit");
  assert.deepEqual(inject, ["tools", "fs"]);
  assert.equal(DEFAULT_CONFIG.defaultMinAppVersion, "1.13.0");
  assert.equal(DEFAULT_CONFIG.obsidianCli, "obsidian");
  assert.equal(DEFAULT_CONFIG.probeActive, true);
});

test("apply registers exactly the eight devkit tools", () => {
  const registered = [];
  apply({ tools: { register: (tool) => registered.push(tool) } });
  assert.deepEqual(
    registered.map((tool) => tool.name).sort(),
    [
      "obsidian_devkit_build",
      "obsidian_devkit_deploy",
      "obsidian_devkit_reload",
      "obsidian_devkit_scaffold",
      "obsidian_devkit_status",
      "obsidian_devkit_test",
      "obsidian_devkit_validate",
      "obsidian_devkit_version",
    ],
  );
  for (const tool of registered) {
    // The harness projects  verbatim as the model-facing function schema.
    // A flat map would reach the model as { type: null } and the request would be rejected.
    assert.equal(tool.parameters.type, "object", tool.name + " parameters must be a JSON Schema object root");
    assert.equal(typeof tool.parameters.properties, "object");
    assert.equal(tool.parameters.additionalProperties, false);
    assert.equal(typeof tool.isConcurrencySafe, "function");
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
  assert.match(
    await byName.obsidian_devkit_deploy.execute({ projectDir: "" }, undefined),
    /requires a non-empty projectDir/i,
  );
  assert.match(
    await byName.obsidian_devkit_test.execute({ projectDir: "" }, undefined),
    /requires a non-empty projectDir/i,
  );
});

test("reload rejects an unknown action before touching the CLI", async () => {
  const registered = [];
  apply({ tools: { register: (tool) => registered.push(tool) } });
  const tool = registered.find((candidate) => candidate.name === "obsidian_devkit_reload");
  assert.match(await tool.execute({ action: "explode" }, undefined), /action must be one of/);
});

test("validate fails softly on a missing directory", async () => {
  const registered = [];
  apply({ tools: { register: (tool) => registered.push(tool) } });
  const tool = registered.find((candidate) => candidate.name === "obsidian_devkit_validate");
  const report = await tool.execute({ projectDir: ".devkit/does-not-exist" }, undefined);
  assert.match(report, /does not exist|not found|Missing|FAIL/i);
});

test("apply also registers the dev skill and the session context when the host exposes them", () => {
  const registered = [];
  const skills = [];
  const contexts = [];
  const ctx = {
    tools: { register: (tool) => registered.push(tool) },
    get: (service) => {
      if (service === "skills") return { register: (skill) => skills.push(skill) };
      if (service === "systemPrompt") return { context: (entry) => contexts.push(entry) };
      return undefined;
    },
  };
  apply(ctx);
  assert.equal(registered.length, 8);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "obsidian-plugin-dev");
  assert.equal(contexts.length, 1);
  assert.match(contexts[0].text, /obsidian_devkit_/);
});

test("apply works with no optional services at all", () => {
  const registered = [];
  assert.doesNotThrow(() => apply({ tools: { register: (tool) => registered.push(tool) } }));
  assert.equal(registered.length, 8);
});
