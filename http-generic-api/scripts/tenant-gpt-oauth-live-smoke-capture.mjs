#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_CAPTURE_CHARS = 1_000_000;
const FORBIDDEN_OUTPUT_KEYS = ["access_token", "client_secret", "authorization_code", "raw_token"];

function failure(code, message, capture = {}) {
  return {
    ok: false,
    error: { code, message },
    capture: {
      child_exit_code: Number.isInteger(capture.child_exit_code) ? capture.child_exit_code : null,
      stdout_json_parsed: capture.stdout_json_parsed === true,
      stderr_present: capture.stderr_present === true,
    },
    secrets_included: false,
  };
}

function parseSafePayload(stdout, capture) {
  let payload;
  try {
    payload = JSON.parse(String(stdout || "").trim());
  } catch {
    return failure("live_smoke_capture_invalid_json", "Live smoke did not return structured JSON.", capture);
  }

  const serialized = JSON.stringify(payload);
  if (FORBIDDEN_OUTPUT_KEYS.some((key) => serialized.includes(`\"${key}\"`))) {
    return failure("live_smoke_capture_sensitive_output_detected", "Live smoke output contained a forbidden sensitive field.", {
      ...capture,
      stdout_json_parsed: true,
    });
  }

  return {
    ...payload,
    capture: {
      child_exit_code: Number.isInteger(capture.child_exit_code) ? capture.child_exit_code : null,
      stdout_json_parsed: true,
      stderr_present: capture.stderr_present === true,
    },
    secrets_included: false,
  };
}

export async function captureTenantGptOAuthLiveSmoke(argv = [], dependencies = {}) {
  const spawnImpl = dependencies.spawnImpl || spawn;
  const smokeScript = dependencies.smokeScript || fileURLToPath(new URL("./tenant-gpt-oauth-live-smoke.mjs", import.meta.url));

  return new Promise((resolve) => {
    const child = spawnImpl(process.execPath, [smokeScript, ...argv.map((value) => String(value))], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.stdout?.on("data", (chunk) => {
      if (stdout.length < MAX_CAPTURE_CHARS) stdout += String(chunk).slice(0, MAX_CAPTURE_CHARS - stdout.length);
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < MAX_CAPTURE_CHARS) stderr += String(chunk).slice(0, MAX_CAPTURE_CHARS - stderr.length);
    });
    child.on("error", () => {
      finish(failure("live_smoke_capture_spawn_failed", "Unable to start the live smoke process."));
    });
    child.on("close", (code) => {
      finish(parseSafePayload(stdout, {
        child_exit_code: code,
        stdout_json_parsed: false,
        stderr_present: Boolean(stderr.trim()),
      }));
    });
  });
}

async function main() {
  const result = await captureTenantGptOAuthLiveSmoke(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
