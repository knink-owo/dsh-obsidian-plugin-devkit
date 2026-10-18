import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runCli } from "../lib/commandline.js";

const root = () => mkdtempSync(join(tmpdir(), "devkit-cli-"));

function capture() {
  const out = [];
  const err = [];
  return {
    out,
    err,
    io: {
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    },
  };
}

function makeProject(dir, { id = "demo-hub", name = "Demo Hub", version = "0.1.0" } = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(
      {
        id,
        name,
        version,
        minAppVersion: "1.13.0",
        description: "A demo plugin for testing.",
        author: "Demo",
        authorUrl: "https://example.com/demo",
        isDesktopOnly: false,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: id, version, description: "A demo plugin for testing." }, null, 2) + "\n",
  );
  writeFileSync(join(dir, "versions.json"), JSON.stringify({ [version]: "1.13.0" }, null, 2) + "\n");
  writeFileSync(join(dir, "README.md"), "# Demo\n");
  writeFileSync(join(dir, "LICENSE"), "MIT\n");
  writeFileSync(join(dir, "main.js"), "module.exports = class Demo {};\n");
  return dir;
}

test("--version prints the package version", async () => {
  const out = capture();
  const code = await runCli(["--version"], { out: out.io.out, err: out.io.err, cwd: root() });
  assert.equal(code, 0);
  assert.match(out.out.join(""), /^\d+\.\d+\.\d+$/m);
});

test("no command is a usage error", async () => {
  const out = capture();
  const code = await runCli([], { out: out.io.out, err: out.io.err, cwd: root() });
  assert.equal(code, 2);
  assert.match(out.err.join(""), /USAGE/);
});

test("help lists every command", async () => {
  const out = capture();
  const code = await runCli(["help"], { out: out.io.out, err: out.io.err, cwd: root() });
  assert.equal(code, 0);
  const text = out.out.join("");
  for (const command of [
    "scaffold",
    "build",
    "validate",
    "version",
    "deploy",
    "status",
    "reload",
    "test",
    "e2e",
    "install-skill",
  ]) {
    assert.ok(text.includes(`  ${command}`), `usage should list ${command}`);
  }
});

test("unknown command and unknown flag exit 2", async () => {
  const out = capture();
  assert.equal(await runCli(["frobnicate"], { out: out.io.out, err: out.io.err, cwd: root() }), 2);
  assert.match(out.err.join(""), /Unknown command/);

  const second = capture();
  assert.equal(
    await runCli(["validate", "--nope"], { out: second.io.out, err: second.io.err, cwd: root() }),
    2,
  );
  assert.match(second.err.join(""), /Unknown option/);
});

test("scaffold writes a project and rejects official-rule violations", async () => {
  const dir = root();
  const { io } = capture();
  const code = await runCli(
    ["scaffold", join(dir, "demo"), "--id", "demo-hub", "--name", "Demo Hub"],
    { out: io.out, err: io.err, cwd: dir },
  );
  assert.equal(code, 0);
  assert.ok(existsSync(join(dir, "demo", "manifest.json")));

  const bad = root();
  const badRun = capture();
  const badCode = await runCli(
    ["scaffold", join(bad, "bad"), "--id", "obsidian-helper-plugin", "--name", "Helper"],
    { out: badRun.io.out, err: badRun.io.err, cwd: bad },
  );
  assert.equal(badCode, 1);
  assert.match(badRun.out.join(""), /FAIL/);
});

test("scaffold without --id is a usage error", async () => {
  const out = capture();
  const code = await runCli(["scaffold", "somewhere", "--name", "X"], {
    out: out.io.out,
    err: out.io.err,
    cwd: root(),
  });
  assert.equal(code, 2);
  assert.match(out.err.join(""), /--id and --name/);
});

test("validate fails on a missing project and passes on a scaffolded one", async () => {
  const dir = root();
  const { io } = capture();
  const missing = await runCli(["validate", join(dir, "nope")], {
    out: io.out,
    err: io.err,
    cwd: dir,
  });
  assert.equal(missing, 1);

  const scaffoldRun = capture();
  await runCli(["scaffold", join(dir, "demo"), "--id", "demo-hub", "--name", "Demo Hub"], {
    out: scaffoldRun.io.out,
    err: scaffoldRun.io.err,
    cwd: dir,
  });
  writeFileSync(join(dir, "demo", "main.js"), "module.exports = class Demo {};\n");
  const validated = capture();
  const code = await runCli(["validate", join(dir, "demo")], {
    out: validated.io.out,
    err: validated.io.err,
    cwd: dir,
  });
  assert.equal(code, 0);
  assert.match(validated.out.join(""), /PASS/);
});

test("version bumps the trio and rejects invalid semver", async () => {
  const dir = makeProject(join(root(), "demo"));
  const ok = capture();
  const code = await runCli(["version", dir, "0.2.0"], {
    out: ok.io.out,
    err: ok.io.err,
    cwd: dir,
  });
  assert.equal(code, 0);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  assert.equal(manifest.version, "0.2.0");
  const packageJson = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  assert.equal(packageJson.version, "0.2.0");

  const bad = capture();
  assert.equal(
    await runCli(["version", dir, "not-semver"], { out: bad.io.out, err: bad.io.err, cwd: dir }),
    1,
  );
  assert.match(bad.err.join(""), /Invalid version/);
});

test("deploy --dry-run reports writes without touching the vault", async () => {
  const dir = makeProject(join(root(), "demo"));
  const vault = join(root(), "vault");
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  const out = capture();
  const code = await runCli(
    ["deploy", dir, "--vault", vault, "--dry-run", "--no-probe"],
    { out: out.io.out, err: out.io.err, cwd: dir },
  );
  assert.equal(code, 0);
  assert.match(out.out.join(""), /dryRun|预览|不会写入/i);
  assert.equal(existsSync(join(vault, ".obsidian", "plugins", "demo-hub")), false);
});

test("test runs the L2 smoke against a CommonJS bundle", async () => {
  const dir = makeProject(join(root(), "demo"));
  writeFileSync(
    join(dir, "main.js"),
    [
      'const { Plugin } = require("obsidian");',
      "module.exports = class Demo extends Plugin {",
      "  async onload() {}",
      "  onunload() {}",
      "};",
      "",
    ].join("\n"),
  );
  const out = capture();
  const code = await runCli(["test", dir, "--scenario", "unload"], {
    out: out.io.out,
    err: out.io.err,
    cwd: dir,
  });
  assert.equal(code, 0);
  assert.match(out.out.join(""), /PASS/);
});

test("test rejects a non-CommonJS bundle", async () => {
  const dir = makeProject(join(root(), "demo"));
  writeFileSync(join(dir, "main.js"), "export default class Demo {}\n");
  const out = capture();
  const code = await runCli(["test", dir], { out: out.io.out, err: out.io.err, cwd: dir });
  assert.equal(code, 1);
});

test("e2e init writes the harness and status audits it", async () => {
  const dir = makeProject(join(root(), "demo"));
  const init = capture();
  const code = await runCli(["e2e", dir], { out: init.io.out, err: init.io.err, cwd: dir });
  assert.equal(code, 0);
  assert.ok(existsSync(join(dir, "wdio.conf.mts")));
  assert.ok(existsSync(join(dir, "e2e", "specs", "plugin.e2e.ts")));
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:e2e"], "wdio run ./wdio.conf.mts");
  assert.ok(pkg.devDependencies["wdio-obsidian-service"]);

  const status = capture();
  const statusCode = await runCli(["e2e", dir, "--action", "status"], {
    out: status.io.out,
    err: status.io.err,
    cwd: dir,
  });
  // Dependencies are not installed in the test project, so status exits 1.
  assert.equal(statusCode, 1);
  assert.match(status.out.join(""), /node_modules|依赖/);
});

test("install-skill copies the bundled skill and refuses silent overwrite", async () => {
  const skillsDir = join(root(), "skills");
  const out = capture();
  const code = await runCli(["install-skill", "--skills-dir", skillsDir], {
    out: out.io.out,
    err: out.io.err,
    cwd: root(),
  });
  assert.equal(code, 0);
  const skillMd = join(skillsDir, "obsidian-plugin-dev", "SKILL.md");
  assert.ok(existsSync(skillMd));
  assert.match(readFileSync(skillMd, "utf8"), /name: obsidian-plugin-dev/);
  assert.ok(existsSync(join(skillsDir, "obsidian-plugin-dev", "reference", "cli.md")));

  const again = capture();
  const codeAgain = await runCli(["install-skill", "--skills-dir", skillsDir], {
    out: again.io.out,
    err: again.io.err,
    cwd: root(),
  });
  assert.equal(codeAgain, 1);
  assert.match(again.err.join(""), /already installed/);

  const forced = capture();
  assert.equal(
    await runCli(["install-skill", "--skills-dir", skillsDir, "--force"], {
      out: forced.io.out,
      err: forced.io.err,
      cwd: root(),
    }),
    0,
  );
});
