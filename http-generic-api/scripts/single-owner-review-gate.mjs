import fs from "node:fs";

export const SINGLE_OWNER_CHECK_NAME = "Single Owner Review Gate";
export const SINGLE_OWNER_ATTESTATION_TOKEN = "OWNER_ATTEST_SINGLE_OWNER";
const ELIGIBLE = new Set(["write", "maintain", "admin"]);

function permissionOf(collaborator = {}) {
  if (collaborator?.permissions?.admin) return "admin";
  if (collaborator?.permissions?.maintain) return "maintain";
  if (collaborator?.permissions?.push) return "write";
  return String(collaborator?.role_name || "").toLowerCase();
}

export function eligibleHumans(collaborators = []) {
  return (Array.isArray(collaborators) ? collaborators : [])
    .filter((item) => item?.type === "User" && ELIGIBLE.has(permissionOf(item)))
    .map((item) => ({ login: item.login, permission: permissionOf(item) }));
}

export function evaluateReviewGate({ owner, author, headSha, collaborators = [], reviews = [] } = {}) {
  const eligible = eligibleHumans(collaborators);
  const byAuthor = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const login = review?.user?.login || review?.author?.login;
    if (!login) continue;
    const previous = byAuthor.get(login);
    const reviewTime = Date.parse(review?.submitted_at || review?.submittedAt || 0) || 0;
    const previousTime = Date.parse(previous?.submitted_at || previous?.submittedAt || 0) || 0;
    if (!previous || reviewTime >= previousTime) byAuthor.set(login, review);
  }
  const independent = eligible.filter((item) => item.login !== author);
  if (independent.length > 0) {
    const approval = independent.find((item) => {
      const review = byAuthor.get(item.login);
      return review?.state === "APPROVED" && review?.commit_id === headSha;
    });
    return {
      ok: Boolean(approval),
      mode: "independent_approval",
      reason: approval ? "eligible_independent_exact_head_approval" : "eligible_independent_exact_head_approval_missing",
      eligible_humans: eligible,
      reviewer: approval?.login || null,
    };
  }
  const singleOwnerEligible = eligible.length === 1 && eligible[0].login === author;
  if (!singleOwnerEligible) {
    return { ok: false, mode: "blocked", reason: "single_owner_eligibility_not_proven", eligible_humans: eligible, reviewer: null };
  }
  const review = byAuthor.get(author);
  const body = String(review?.body || "");
  const attested = review?.state === "COMMENTED"
    && review?.commit_id === headSha
    && body.includes(SINGLE_OWNER_ATTESTATION_TOKEN)
    && body.includes(headSha);
  return {
    ok: attested,
    mode: "single_owner_attestation",
    reason: attested ? "single_owner_exact_head_attestation" : "single_owner_exact_head_attestation_missing",
    eligible_humans: eligible,
    reviewer: attested ? author : null,
  };
}

async function api(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body?.message || url}`);
  return body;
}

async function listAll(url, token) {
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = url.includes("?") ? "&" : "?";
    const batch = await api(`${url}${separator}per_page=100&page=${page}`, token);
    if (!Array.isArray(batch)) throw new Error(`Expected array from ${url}`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error(`Pagination safety bound exceeded for ${url}`);
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  if (!eventPath || !token || !repo) throw new Error("GITHUB_EVENT_PATH, GITHUB_TOKEN and GITHUB_REPOSITORY are required");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const prNumber = event.pull_request?.number || event.review?.pull_request_url?.split("/").pop();
  if (!prNumber) throw new Error("Pull request number is required");
  const pr = await api(`${apiBase}/repos/${repo}/pulls/${prNumber}`, token);
  if (pr.base?.ref !== "main") {
    console.log(JSON.stringify({
      ok: true,
      mode: "not_applicable",
      reason: "non_main_target",
      pr_number: Number(prNumber),
      exact_head_sha: pr.head?.sha || null,
      secrets_included: false,
    }));
    return;
  }
  const [collaborators, reviews] = await Promise.all([
    listAll(`${apiBase}/repos/${repo}/collaborators?affiliation=all`, token),
    listAll(`${apiBase}/repos/${repo}/pulls/${prNumber}/reviews`, token),
  ]);
  const result = evaluateReviewGate({
    owner: pr.base?.repo?.owner?.login || repo.split("/")[0],
    author: pr.user?.login,
    headSha: pr.head.sha,
    collaborators,
    reviews,
  });
  const summary = JSON.stringify({ ...result, pr_number: Number(prNumber), exact_head_sha: pr.head.sha, secrets_included: false });
  console.log(summary);
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
