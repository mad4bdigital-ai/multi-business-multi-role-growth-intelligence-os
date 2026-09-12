#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildHostBreakglassPlan } from "../hostBreakglassCatalog.js";
import { verifyHostBreakglassLocalRequest } from "../hostBreakglassLocalRequest.js";
import { readStagingRuntimeBootstrapContract } from "../stagingRuntimeBootstrapContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(HERE, "..");
const LEGACY_RUNNER = path.join(HERE, "host-breakglass-local.mjs");

function fail(code, message, status = 409) {
  throw Object.assign(new Error(message), { code, status });
}

function requestFileFromArgs(args) {
  const index = args.indexOf("--request-file");
  if (index < 0 || !args[index + 1]) fail("host_breakglass_local_request_file_required", "--request-file <path> is required.", 400);
  return { index, path: path.resolve(process.cwd(), args[index + 1]) };
}

export function rebuildVerifiedStagingPlan(request = {}) {
  const planInput = verifyHostBreakglassLocalRequest(request);
  const bootstrapContract = readStagingRuntimeBootstrapContract();
  const roleSelectiveRebuild = planInput.operation_key === "database.rebuild_empty" && planInput.action === "apply_migration";
  const durableProof = roleSelectiveRebuild ? planInput.role_selection_proof : null;
  if (roleSelectiveRebuild && durableProof?.source !== "durable_full_inspection") {
    fail("host_breakglass_local_role_selection_provenance_invalid", "Verified selective rebuild requires the server-resolved durable full-inspection proof.");
  }
  const rebuilt = buildHostBreakglassPlan(planInput, {
    bootstrapContract,
    ...(durableProof ? { proofResolver: () => durableProof } : {}),
  });
  if (rebuilt.plan_sha256 !== request.plan_sha256) {
    fail("host_breakglass_local_plan_mismatch", "The local checkout rebuilt a different Host Breakglass transport plan; execution is forbidden.");
  }
  return rebuilt;
}

export const rebuildVerifiedStagingAccessRepairPlan = rebuildVerifiedStagingPlan;

export function verifyHostBreakglassLocalRequestFile(requestPath) {
  if (!fs.existsSync(requestPath) || !fs.statSync(requestPath).isFile()) fail("host_breakglass_local_request_file_missing", "Verified Host Breakglass request file does not exist.", 400);
  if (fs.statSync(requestPath).size > 256 * 1024) fail("host_breakglass_local_request_file_too_large", "Verified Host Breakglass request file exceeds the bounded size limit.", 400);
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const plan = rebuildVerifiedStagingPlan(request);
  return { request, plan };
}

async function main() {
  const args = process.argv.slice(2);
  try {
    const requestFile = requestFileFromArgs(args);
    const verified = verifyHostBreakglassLocalRequestFile(requestFile.path);
    const delegatedArgs = [...args];
    delegatedArgs[requestFile.index + 1] = requestFile.path;
    const child = spawnSync(process.execPath, [LEGACY_RUNNER, ...delegatedArgs], {
      cwd: API_ROOT,
      env: {
        ...process.env,
        HOST_BREAKGLASS_VERIFIED_REQUEST_SHA256: verified.request.request_sha256,
        HOST_BREAKGLASS_AUTHORITY_PLAN_HASH: verified.request.authority_plan_hash || "",
      },
      stdio: "inherit",
      windowsHide: true,
    });
    if (child.error) throw child.error;
    process.exit(Number.isInteger(child.status) ? child.status : 1);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      contract: "mad4b.host-breakglass-local-request-verifier.v2",
      status: "verified_request_rejected",
      error: {
        code: error?.code || "host_breakglass_local_request_verification_failed",
        message: error?.message || "Verified Host Breakglass request verification failed.",
      },
      database_mutation_performed: false,
      production_authority: false,
      secrets_included: false,
    })}\n`);
    process.exit(1);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) await main();
