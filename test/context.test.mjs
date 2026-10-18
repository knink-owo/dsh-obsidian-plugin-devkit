import { test } from "node:test";
import assert from "node:assert/strict";

import { CONTEXT_ORDER, contextText, FALLBACK_CONTEXT_TEXT, registerDevContext } from "../lib/context.js";

test("the injected context text ships with the bundle and mentions the devkit", () => {
  const text = contextText();
  assert.ok(text.length > 200);
  assert.match(text, /obsidian_devkit_/);
  assert.match(text, /obsidian-plugin-dev/);
  assert.notEqual(text, FALLBACK_CONTEXT_TEXT);
});

test("registerDevContext prefers the dynamic context method", () => {
  const entries = [];
  const ctx = {
    tools: { register() {} },
    get: (key) => (key === "systemPrompt" ? { context: (entry) => entries.push(entry) } : undefined),
  };
  const result = registerDevContext(ctx);
  assert.equal(result.registered, true);
  assert.equal(result.order, CONTEXT_ORDER);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "obsidian-plugin-devkit");
  assert.equal(entries[0].order, CONTEXT_ORDER);
  assert.equal(entries[0].required, undefined);
  assert.match(entries[0].text, /分层/);
});

test("registerDevContext falls back to a prompt section", () => {
  const sections = [];
  const ctx = { tools: { register() {} }, get: (key) => (key === "systemPrompt" ? { section: (entry) => sections.push(entry) } : undefined) };
  const result = registerDevContext(ctx, { text: "custom context", order: 77 });
  assert.equal(result.registered, true);
  assert.equal(sections[0].text, "custom context");
  assert.equal(sections[0].order, 77);
});

test("registerDevContext is optional and never throws", () => {
  assert.equal(registerDevContext({ tools: { register() {} } }).registered, false);

  const warnings = [];
  const throwing = {
    tools: { register() {} },
    logger: { warn: (message) => warnings.push(message) },
    get: (key) => (key === "systemPrompt" ? { context() { throw new Error("read-only prompt"); } } : undefined),
  };
  const result = registerDevContext(throwing);
  assert.equal(result.registered, false);
  assert.match(result.reason, /threw/);
  assert.equal(warnings.length, 1);
});
