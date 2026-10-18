import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildVars,
  renderScaffoldFiles,
  renderTemplate,
} from "../lib/templates.js";

const vars = buildVars({
  id: "my-hub",
  name: "My Hub",
  description: 'A "quoted" hub.',
  author: "Knink",
  authorUrl: "https://github.com/knink-owo",
  version: "0.1.0",
  minAppVersion: "1.13.0",
  desktopOnly: false,
  packageManager: "pnpm",
  year: 2026,
});

test("plain substitution", () => {
  assert.equal(renderTemplate("hello {{PLUGIN_NAME}}", vars), "hello My Hub");
});

test("JSON filter escapes but does not add quotes", () => {
  const rendered = renderTemplate('"{{PLUGIN_DESCRIPTION|JSON}}"', vars);
  assert.equal(rendered, '"A \\"quoted\\" hub."');
  assert.equal(JSON.parse(rendered), 'A "quoted" hub.');
});

test("inline conditionals keep or drop their content", () => {
  const template = 'a{{#IF_AUTHOR_URL}}, "url"{{/IF_AUTHOR_URL}}, b';
  assert.equal(renderTemplate(template, vars), 'a, "url", b');
  assert.equal(
    renderTemplate(template, { ...vars, AUTHOR_URL: "" }),
    "a, b",
  );
});

test("unknown variables fail loudly", () => {
  assert.throws(() => renderTemplate("{{NOPE}}", vars), /Unknown template variable/);
});

test("manifest template renders valid JSON with and without an author URL", () => {
  for (const style of ["declarative", "legacy"]) {
    const files = renderScaffoldFiles(vars, style);
    const manifest = JSON.parse(files.find((file) => file.dest === "manifest.json").content);
    assert.equal(manifest.id, "my-hub");
    assert.equal(manifest.authorUrl, "https://github.com/knink-owo");
    assert.equal(manifest.isDesktopOnly, false);
    assert.equal(manifest.version, "0.1.0");
  }
  const withoutUrl = renderScaffoldFiles({ ...vars, AUTHOR_URL: "" }, "declarative");
  const manifest = JSON.parse(withoutUrl.find((file) => file.dest === "manifest.json").content);
  assert.equal(manifest.authorUrl, undefined);
  assert.ok(JSON.stringify(manifest).length > 0);
});

test("both settings flavours produce the expected tab source", () => {
  const declarative = renderScaffoldFiles(vars, "declarative");
  const legacy = renderScaffoldFiles(vars, "legacy");
  const settingsOf = (files) => files.find((file) => file.dest === "src/settings.ts").content;
  assert.match(settingsOf(declarative), /getSettingDefinitions\s*\(\s*\)/);
  assert.doesNotMatch(settingsOf(declarative), /^\s*display\s*\(\s*\)/m);
  assert.match(settingsOf(legacy), /^\s*display\s*\(\s*\)/m);
  assert.doesNotMatch(settingsOf(legacy), /^\s*getSettingDefinitions\s*\(\s*\)/m);
});

test("no placeholder survives rendering", () => {
  for (const style of ["declarative", "legacy"]) {
    for (const file of renderScaffoldFiles(vars, style)) {
      assert.doesNotMatch(file.content, /\{\{[A-Z0-9_|#/]+\}\}/, `${file.dest} has a placeholder`);
    }
  }
});
