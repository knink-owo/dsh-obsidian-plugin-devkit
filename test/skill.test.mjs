import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bundledSkill,
  parseSkillFrontmatter,
  REFERENCE_FILES,
  registerSkill,
  skillDirectory,
  skillFromText,
} from "../lib/skill.js";
import { readAsset } from "../lib/fs.js";

const SKILL_DIR = "../assets/skills/obsidian-plugin-dev";

test("the bundled skill has complete frontmatter and a real body", () => {
  const skill = bundledSkill();
  assert.equal(skill.name, "obsidian-plugin-dev");
  assert.ok(skill.description.length > 80, "description is the catalog line the model sees");
  assert.ok((skill.whenToUse ?? "").length > 40);
  assert.equal(skill.source, "runtime");
  assert.match(skill.content, /## Workflow/);
  assert.match(skill.content, /obsidian_devkit_scaffold/);
  assert.equal(skill.resourceBase.kind, "directory");
  assert.ok(skill.resourceBase.path.endsWith("assets\\skills\\obsidian-plugin-dev") || skill.resourceBase.path.endsWith("assets/skills/obsidian-plugin-dev"));
});

test("every reference file referenced by the skill ships with the bundle", () => {
  for (const file of REFERENCE_FILES) {
    const text = readAsset(`${SKILL_DIR}/${file}`);
    assert.ok(text.length > 400, `${file} looks empty`);
    assert.match(text, /^# /m);
  }
  assert.equal(skillDirectory().endsWith("obsidian-plugin-dev"), true);
});

test("parseSkillFrontmatter tolerates missing or malformed frontmatter", () => {
  assert.deepEqual(parseSkillFrontmatter("# no frontmatter"), {
    frontmatter: {},
    body: "# no frontmatter",
  });
  const parsed = parseSkillFrontmatter('---\nname: "quoted"\nbad line\n---\nbody\n');
  assert.equal(parsed.frontmatter.name, "quoted");
  assert.equal(parsed.body, "body\n");
  const noBody = parseSkillFrontmatter("---\nname: x\n---\n");
  assert.equal(noBody.frontmatter.name, "x");
});

test("skillFromText applies defaults and carries metadata", () => {
  const skill = skillFromText("---\nname: custom-skill\nlicense: MIT\nversion: 2.0.0\n---\nbody\n", "/tmp/dir");
  assert.equal(skill.name, "custom-skill");
  assert.equal(skill.description.length > 0, true);
  assert.equal(skill.metadata.license, "MIT");
  assert.equal(skill.metadata.version, "2.0.0");
  assert.deepEqual(skill.resourceBase, { kind: "directory", path: "/tmp/dir" });
});

test("registerSkill files into the optional skills service", () => {
  const registered = [];
  const ctx = { tools: { register() {} }, get: (key) => (key === "skills" ? { register: (skill) => registered.push(skill) } : undefined) };
  const result = registerSkill(ctx);
  assert.deepEqual(result, { registered: true, name: "obsidian-plugin-dev" });
  assert.equal(registered.length, 1);
  assert.match(registered[0].content, /## Hard rules/);
});

test("registerSkill degrades silently without the service and reports thrown registrations", () => {
  const absent = registerSkill({ tools: { register() {} } });
  assert.equal(absent.registered, false);
  assert.match(absent.reason, /unavailable/);

  const warnings = [];
  const throwing = {
    tools: { register() {} },
    logger: { warn: (message) => warnings.push(message) },
    get: (key) => (key === "skills" ? { register() { throw new Error("boom"); } } : undefined),
  };
  const failed = registerSkill(throwing);
  assert.equal(failed.registered, false);
  assert.match(failed.reason, /threw/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /boom/);
});
