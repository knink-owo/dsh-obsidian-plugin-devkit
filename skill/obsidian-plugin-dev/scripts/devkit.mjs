#!/usr/bin/env node
/**
 * Local entry point for the vendored obsidian-devkit runtime.
 * Use: node scripts/devkit.mjs <command> [options]
 */
import { runCli } from "./lib/commandline.js";

process.exitCode = await runCli(process.argv.slice(2), { cwd: process.cwd() });
