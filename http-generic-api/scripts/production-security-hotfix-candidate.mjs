import { spawnSync } from "node:child_process";

const SHA = /^[0-9a-f]{40}$/;
const HOTFIX_REF = /^security\/production-(?:api-lockfile|hotfix)-\d{8}(?:-[a-z0-9-]+)?$/;
const LOCKFILES = new Set(["package-lock.json", "http-generic-api/package-lock.json"]);
const MUTABLE_FIELDS = new Set(["version", "resolved", "integrity", "dependencies", "engines", "funding"]);

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.error || result.status !== 0 ? null : String(result.stdout || "").trim();
}

function fail(reason) {
  return Object.freeze({ ok: false, reason, authority_eligible: false });
}

function isUpgrade(previous, next) {
  const parts = (value) => /^\d+\.\d+\.\d+$/.test(value || "")
    ? value.split(".").map(Number) : null;
  const a = parts(previous);
  const b = parts(next);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (b[i] !== a[i]) return b[i] > a[i];
  }
  return false;
}

function compareLockfiles(before, after) {
  if (before.lockfileVersion !== after.lockfileVersion || before.name !== after.name
    || before.version !== after.version) return false;
  if (JSON.stringify(before.packages?.[""]) !== JSON.stringify(after.packages?.[""])) return false;
  const a = before.packages || {};
  const b = after.packages || {};
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (JSON.stringify(aKeys) !== JSON.stringify(bKeys)) return false;
  const otherKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of otherKeys) {
    if (key === "packages") continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) return false;
  }
  let upgraded = 0;
  for (const key of aKeys) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    if (!/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(key)) return false;
    if (!isUpgrade(a[key]?.version, b[key]?.version)) return false;
    const props = new Set([...Object.keys(a[key] || {}), ...Object.keys(b[key] || {})]);
    for (const prop of props) {
      if (!MUTABLE_FIELDS.has(prop) && JSON.stringify(a[key]?.[prop]) !== JSON.stringify(b[key]?.[prop])) return false;
    }
    if (!/^https:\/\/registry\.npmjs\.org\//.test(b[key]?.resolved || "")
      || !/^sha512-[A-Za-z0-9+/=]+$/.test(b[key]?.integrity || "")) return false;
    upgraded += 1;
  }
  return upgraded > 0;
}

/**
 * Classifies a review candidate only. It is NEVER a Production promotion
 * authorization, an owner attestation, or a deploy/release-ready certificate.
 */
export function inspectProductionSecurityHotfix({ root, baseRef, headRef, baseSha, headSha }) {
  if (baseRef !== "Production" || !HOTFIX_REF.test(headRef || "")) return fail("unsupported_identity");
  if (!SHA.test(baseSha || "") || !SHA.test(headSha || "") || baseSha === headSha) return fail("invalid_commit_pair");
  const live = git(root, ["ls-remote", "--heads", "origin", "refs/heads/Production"]);
  if (!live || live.split(/\r?\n/).length !== 1 || live.split(/\s+/)[0] !== baseSha) return fail("production_base_not_live");
  if (git(root, ["rev-parse", "--verify", `${headSha}^{commit}`]) !== headSha) return fail("head_unavailable");
  if (git(root, ["rev-parse", "--verify", `${baseSha}^{commit}`]) !== baseSha) return fail("base_unavailable");
  if (git(root, ["merge-base", "--is-ancestor", baseSha, headSha]) === null) {
    // merge-base --is-ancestor succeeds without stdout; check exit code independently.
    const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", baseSha, headSha], { cwd: root, stdio: "ignore" });
    if (ancestor.status !== 0 || ancestor.error) return fail("not_descendant_of_production");
  }
  const count = Number(git(root, ["rev-list", "--count", `${baseSha}..${headSha}`]));
  if (!Number.isInteger(count) || count < 1 || count > 4) return fail("candidate_commit_span");
  if (git(root, ["rev-list", "--merges", `${baseSha}..${headSha}`])) return fail("merge_commit_in_hotfix");
  const paths = git(root, ["diff", "--name-only", baseSha, headSha, "--"]);
  if (!paths) return fail("empty_diff");
  const filenames = paths.split(/\r?\n/).filter(Boolean);
  if (filenames.some((name) => !LOCKFILES.has(name))) return fail("scope_outside_lockfiles");
  for (const file of filenames) {
    const oldText = git(root, ["show", `${baseSha}:${file}`]);
    const newText = git(root, ["show", `${headSha}:${file}`]);
    if (!oldText || !newText) return fail("missing_lockfile");
    let oldLock, newLock;
    try {
      oldLock = JSON.parse(oldText);
      newLock = JSON.parse(newText);
    } catch { return fail("malformed_lockfile"); }
    if (!compareLockfiles(oldLock, newLock)) return fail("non_upgrade_lockfile_change");
  }
  return Object.freeze({
    ok: true,
    identity: "production_security_hotfix_candidate",
    authority_eligible: false,
    production_promotion: false,
    base_sha: baseSha,
    head_sha: headSha,
    changed_files: filenames.sort(),
    requires_independent_owner_attestation: true,
    requires_trusted_finalizer_and_branch_policy: true,
  });
}
