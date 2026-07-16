#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(here, "dev-governed-migration-client.mjs");

const exitCode = await new Promise((resolve) => {
  const child = spawn(process.execPath, [clientPath, ...process.argv.slice(2)], {
    shell: false,
    stdio: "inherit",
    env: {
      ...process.env,
      DEV_MIGRATION_APPLY_ENABLED: "true",
    },
  });
  child.once("error", () => resolve(1));
  child.once("exit", (code, signal) => resolve(signal ? 1 : Number(code || 0)));
});

process.exitCode = exitCode;
