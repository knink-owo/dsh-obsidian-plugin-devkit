import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareSemver,
  descriptionProblems,
  isSemver,
  namingProblems,
  namingWarnings,
  pluginIdProblems,
  pluginNameProblems,
  toClassName,
  toPluginId,
} from "../lib/naming.js";

const minimal = {
  id: "my-hub",
  name: "My Hub",
  description: "A small hub for my notes.",
  author: "Knink",
  version: "0.1.0",
  minAppVersion: "1.13.0",
};

test("plugin ids follow the community submission rules", () => {
  assert.deepEqual(pluginIdProblems("my-hub"), []);
  assert.deepEqual(pluginIdProblems("my_hub_2"), []);
  // Capital letters are rejected.
  assert.ok(pluginIdProblems("MyHub").some((problem) => /lowercase/.test(problem)));
  // The word obsidian is reserved.
  assert.ok(pluginIdProblems("obsidian-hub").some((problem) => /obsidian/i.test(problem)));
  // Ids must not end with "plugin".
  assert.ok(pluginIdProblems("notes-plugin").some((problem) => /end with/i.test(problem)));
  // Spaces and dots are rejected.
  assert.ok(pluginIdProblems("my hub").length > 0);
});

test("plugin names follow the community submission rules", () => {
  assert.deepEqual(pluginNameProblems("My Hub"), []);
  assert.ok(pluginNameProblems("Obsidian Hub").some((problem) => /Obsidian/.test(problem)));
  assert.ok(pluginNameProblems("My Plugin").some((problem) => /Plugin/.test(problem)));
  assert.ok(pluginNameProblems("Notes 🚀").some((problem) => /emoji|Latin/.test(problem)));
  assert.ok(pluginNameProblems("ObsiHub").some((problem) => /Obsi/.test(problem)));
});

test("descriptions must be sentence-like", () => {
  assert.deepEqual(descriptionProblems("A small hub for my notes."), []);
  assert.ok(descriptionProblems("A small hub for my notes").some((problem) => /punctuation/.test(problem)));
  assert.ok(descriptionProblems(`Uses ${"x".repeat(260)}.`).some((problem) => /250/.test(problem)));
  assert.ok(descriptionProblems("Emoji 🚀 inside.").some((problem) => /emoji/.test(problem)));
});

test("soft description guidelines are warnings, not blocks", () => {
  const warnings = namingWarnings({
    ...minimal,
    description: "This plugin lives in an Obsidian vault.",
  });
  assert.ok(warnings.some((warning) => /This plugin/.test(warning)));
  assert.ok(warnings.some((warning) => /Obsidian/.test(warning)));
  assert.deepEqual(namingWarnings(minimal), []);
});

test("namingProblems aggregates blocking issues and warnings stay advisory", () => {
  assert.deepEqual(namingProblems(minimal), []);
  const bad = namingProblems({
    ...minimal,
    id: "obsidian-notes-plugin",
    name: "Obsidian Plugin",
    description: "no period",
  });
  assert.ok(bad.length >= 3);
  assert.deepEqual(namingWarnings(minimal), []);
});

test("id and class helpers normalise display names", () => {
  assert.equal(toPluginId("My Notes Hub"), "my-notes-hub");
  assert.equal(toPluginId("  Hello, World!  "), "hello-world");
  assert.equal(toPluginId("plugin"), "plugin-tools");
  assert.equal(toPluginId("obsidian-notes"), "vault-notes");
  assert.equal(toClassName("my notes hub"), "MyNotesHub");
  assert.equal(toClassName("2fast 2notes"), "Plugin2fast2notes");
});

test("semver handling", () => {
  assert.ok(isSemver("1.2.3"));
  assert.ok(!isSemver("1.2"));
  assert.ok(!isSemver("v1.2.3"));
  assert.equal(compareSemver("1.13.0", "1.13.0"), 0);
  assert.ok(compareSemver("1.14.0", "1.13.0") > 0);
  assert.ok(compareSemver("1.9.0", "1.13.0") < 0);
  assert.ok(compareSemver("2.0.0-beta.1", "1.9.9") > 0);
});
