#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { inspectHotfixSourcePin, verifyOwnerReview } from "./production-security-hotfix-source-pin.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-hotfix-source-pin-"));
const root = path.join(tmp, "review");
const origin = path.join(tmp, "origin.git");
const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore","pipe","pipe"] }).trim();
const owner = "mad4bdigital-ai";
let passed = 0;
function expectDenied(input, reason) {
  const result = inspectHotfixSourcePin(input);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, reason, JSON.stringify(result));
  assert.equal(result.authority_eligible, false);
  passed++;
}
try {
  fs.mkdirSync(root);
  git(["init","--bare",origin],tmp);
  git(["init","-b","Production"]);
  git(["config","user.name","CI Test"]);
  git(["config","user.email","test@example.invalid"]);
  git(["remote","add","origin",origin]);
  const writeLock = version => fs.writeFileSync(path.join(root,"package-lock.json"), JSON.stringify({
    name:"test",version:"1.0.0",lockfileVersion:3,packages:{"":{name:"test",version:"1.0.0"},
    "node_modules/dep":{version,resolved:`https://registry.npmjs.org/dep/-/dep-${version}.tgz`,integrity:"sha512-MTIzNA==",license:"MIT"}}
  })+"\n");
  writeLock("1.0.0");
  git(["add","."]); git(["commit","-m","baseline"]);git(["push","origin","Production"]);
  const baseSha=git(["rev-parse","HEAD"]);
  git(["switch","-c","security/production-hotfix-20261017"]);writeLock("1.0.1");
  git(["add","."]);git(["commit","-m","dependency fix"]);
  const headSha=git(["rev-parse","HEAD"]);
  const body=`OWNER_ATTEST_SINGLE_OWNER\nexact_head_sha: ${headSha}\n\nReview-only. No merge or deploy.\n`;
  const review={user:{login:owner},state:"COMMENTED",commit_id:headSha,submitted_at:"2026-10-17T12:00:00Z",body};
  const pr={state:"open",draft:false,title:"security(Production): lockfile update",base:{ref:"Production",sha:baseSha,repo:{full_name:"mad4bdigital-ai/example"}},head:{ref:"security/production-hotfix-20261017",sha:headSha,repo:{full_name:"mad4bdigital-ai/example"}}};
  const good={root,baseRef:"Production",headRef:pr.head.ref,baseSha,headSha,owner,reviews:[review],pr};
  const allowed=inspectHotfixSourcePin(good);
  assert.equal(allowed.ok,true,JSON.stringify(allowed));passed++;
  assert.equal(allowed.merge_authorized,false);passed++;
  assert.equal(allowed.deployment_authorized,false);passed++;
  assert.equal(allowed.authority_eligible,false);passed++;
  expectDenied({...good,reviews:[]},"exact_owner_review_missing");
  expectDenied({...good,reviews:[{...review,commit_id:baseSha}]},"exact_owner_review_missing");
  expectDenied({...good,reviews:[{...review,user:{login:"attacker"}}]},"exact_owner_review_missing");
  expectDenied({...good,reviews:[{...review,body:body.replace("OWNER_ATTEST_SINGLE_OWNER","OWNER_ATTEST_NOT_VALID")}]},"exact_owner_review_missing");
  expectDenied({...good,reviews:[{...review,state:"DISMISSED"}]},"exact_owner_review_missing");
  expectDenied({...good,owner:"wrong-owner"},"exact_owner_review_missing");
  expectDenied({...good,pr:{...pr,draft:true}},"pr_not_ready_for_review");
  expectDenied({...good,pr:{...pr,head:{...pr.head,sha:baseSha}}},"pr_identity_not_exact");
  expectDenied({...good,pr:{...pr,head:{...pr.head,repo:{full_name:"other/repo"}}}},"pr_identity_not_exact");
  expectDenied({...good,pr:{...pr,title:"release: promote pinned main"}},"pr_title_not_security");
  expectDenied({...good,baseSha:"e".repeat(40)},"pr_identity_not_exact");
  assert.equal(verifyOwnerReview([review],owner,headSha),true);passed++;
  console.log(JSON.stringify({ok:true,scenarios:passed,check:"exact-owner-and-source-pin",merge_authorized:false,production_mutation_performed:false}));
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
