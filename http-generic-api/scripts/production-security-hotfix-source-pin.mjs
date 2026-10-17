#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectProductionSecurityHotfix } from "./production-security-hotfix-candidate.mjs";

export const CONTRACT = "mad4b.production-security-hotfix-source-pin.v1";
const SHA = /^[0-9a-f]{40}$/;
const normalize = (s) => String(s || "").trim();
const fail = (reason) => Object.freeze({ ok: false, reason, contract: CONTRACT, authority_eligible: false, merge_authorized: false, deployment_authorized: false, secrets_included: false });

export function verifyOwnerReview(reviews, owner, exactHead) {
  if (!Array.isArray(reviews) || !owner || !SHA.test(exactHead)) return false;
  return reviews.some((review) => {
    if (review?.user?.login !== owner || review?.state !== "COMMENTED" || review?.commit_id !== exactHead) return false;
    if (!Number.isFinite(Date.parse(review?.submitted_at || ""))) return false;
    const content = String(review?.body || "").replace(/\r\n/g, "\n");
    return /^OWNER_ATTEST_SINGLE_OWNER$/m.test(content)
      && new RegExp("^exact_head_sha: " + exactHead + "$", "m").test(content);
  });
}

export function inspectHotfixSourcePin({ root, baseRef, headRef, baseSha, headSha, owner, reviews, pr }) {
  if (!SHA.test(baseSha || "") || !SHA.test(headSha || "")) return fail("exact_sha_required");
  if (!pr || pr.state !== "open" || pr.base?.ref !== "Production" || pr.base?.sha !== baseSha
    || pr.head?.sha !== headSha || pr.head?.ref !== headRef
    || pr.head?.repo?.full_name !== pr.base?.repo?.full_name) return fail("pr_identity_not_exact");
  if (!/^security\(Production\): [^\n]+$/.test(normalize(pr.title))) return fail("pr_title_not_security");
  if (pr?.draft !== false) return fail("pr_not_ready_for_review");
  const candidate = inspectProductionSecurityHotfix({ root, baseRef, headRef, baseSha, headSha });
  if (!candidate.ok) return fail(candidate.reason);
  if (!verifyOwnerReview(reviews, owner, headSha)) return fail("exact_owner_review_missing");
  return Object.freeze({
    ok: true, contract: CONTRACT, identity: "production_security_hotfix_source_pin",
    base_sha: baseSha, head_sha: headSha, reviewed_owner: owner,
    review_record_verified: true, changed_files: candidate.changed_files,
    source_pin_verified: true, production_promotion: false,
    authority_eligible: false, merge_authorized: false, deployment_authorized: false,
    production_mutation_performed: false, secrets_included: false
  });
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0 || !argv[i + 1]) throw Error("required argument missing: " + flag);
  return argv[i + 1];
}
function main() {
  const argv = process.argv.slice(2);
  const prPath = argValue(argv, "--pr-file");
  const reviewsPath = argValue(argv, "--reviews-file");
  const root = path.resolve(argValue(argv, "--root"));
  const options = {
    root,
    baseRef: argValue(argv, "--base-ref"),
    headRef: argValue(argv, "--head-ref"),
    baseSha: argValue(argv, "--base-sha"),
    headSha: argValue(argv, "--head-sha"),
    owner: argValue(argv, "--owner"),
    pr: JSON.parse(fs.readFileSync(prPath, "utf8").replace(/^\uFEFF/, "")),
    reviews: JSON.parse(fs.readFileSync(reviewsPath, "utf8").replace(/^\uFEFF/, ""))
  };
  const report = inspectHotfixSourcePin(options);
  const output = JSON.stringify(report, null, 2) + "\n";
  if (argv.includes("--output")) {
    const dest = path.resolve(argValue(argv, "--output"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, output, { flag: "wx" }); // A fresh evidence report only; never overwrite an existing one.
  }
  process.stdout.write(output);
  if (!report.ok) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
