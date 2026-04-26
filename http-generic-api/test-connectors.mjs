/**
 * Connector contract tests for github.js and hostinger.js
 * Run: node test-connectors.mjs
 */

import { hostingerSshRuntimeRead, matchesHostingerSshTarget } from "./hostinger.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name}`);
}

async function importGithubModule(tag) {
  return import(new URL(`./github.js?case=${tag}`, import.meta.url).href);
}

section("hostinger.js — matchesHostingerSshTarget");

const hostingerRow = {
  hosting_provider: "Hostinger",
  hosting_account_key: "hostinger_main",
  account_identifier: "acct_123",
  resolver_target_keys_json: '["site_alpha","site_beta"]',
  brand_sites_json: '[{"site":"https://example.com"}]'
};

assert(
  "matches by hosting_account_key",
  matchesHostingerSshTarget(hostingerRow, { hosting_account_key: "hostinger_main" }) === true
);
assert(
  "matches by account_identifier",
  matchesHostingerSshTarget(hostingerRow, { account_identifier: "acct_123" }) === true
);
assert(
  "matches by resolver target_key",
  matchesHostingerSshTarget(hostingerRow, { target_key: "site_beta" }) === true
);
assert(
  "matches by normalized site_url",
  matchesHostingerSshTarget(hostingerRow, { site_url: "https://EXAMPLE.com" }) === true
);
assert(
  "does not match non-hostinger provider rows",
  matchesHostingerSshTarget({ ...hostingerRow, hosting_provider: "aws" }, { hosting_account_key: "hostinger_main" }) === false
);
assert(
  "does not match unrelated inputs",
  matchesHostingerSshTarget(hostingerRow, { target_key: "site_gamma" }) === false
);

{
  const result = await hostingerSshRuntimeRead(
    { input: { target_key: "site_beta" } },
    {
      REGISTRY_SPREADSHEET_ID: "sheet_123",
      HOSTING_ACCOUNT_REGISTRY_RANGE: "Hosting Account Registry!A:Z",
      HOSTING_ACCOUNT_REGISTRY_SHEET: "Hosting Account Registry",
      async getGoogleClientsForSpreadsheet() {
        return {
          sheets: {
            spreadsheets: {
              values: {
                async get() {
                  return {
                    data: {
                      values: [
                        [
                          "hosting_provider",
                          "hosting_account_key",
                          "account_identifier",
                          "resolver_target_keys_json",
                          "brand_sites_json",
                          "ssh_available",
                          "wp_cli_available",
                          "shared_access_enabled",
                          "resolver_execution_ready"
                        ],
                        [
                          "Hostinger",
                          "hostinger_main",
                          "acct_123",
                          '["site_alpha","site_beta"]',
                          '[{"site":"https://example.com"}]',
                          "TRUE",
                          "FALSE",
                          "TRUE",
                          "TRUE"
                        ]
                      ]
                    }
                  };
                }
              }
            }
          }
        };
      }
    }
  );

  assert("hostinger runtime read resolves matching row", result.ok === true, JSON.stringify(result));
  assert("hostinger runtime read preserves authoritative source", result.authoritative_source === "Hosting Account Registry", JSON.stringify(result));
  assert("hostinger runtime read normalizes booleans", result.ssh_available === true && result.wp_cli_available === false, JSON.stringify(result));
}

process.env.GITHUB_TOKEN = "test_token";
const fetchCalls = [];

section("github.js — generateAgentBranchName");

{
  const { generateAgentBranchName } = await importGithubModule("branch-name");
  const name1 = generateAgentBranchName({ prefix: "agent", task_slug: "Fix Governance Rules" });
  assert(
    "branch name starts with prefix/date",
    /^agent\/\d{4}-\d{2}-\d{2}\/fix-governance-rules\/[a-z0-9]+$/.test(name1),
    name1
  );
  const name2 = generateAgentBranchName({ prefix: "fix" });
  assert("branch name with no slug omits slug segment", /^fix\/\d{4}-\d{2}-\d{2}\/[a-z0-9]+$/.test(name2), name2);
  const name3 = generateAgentBranchName();
  assert("branch name uses agent prefix by default", name3.startsWith("agent/"), name3);
}

section("github.js — githubPreviewFileUpdates (dry-run + policy)");

{
  fetchCalls.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ type: "file", size: 100, sha: "existing_sha", encoding: "base64", content: Buffer.from("old").toString("base64") });
      }
    };
  };

  const { githubPreviewFileUpdates } = await importGithubModule("preview-file-updates");

  const denied_result = await githubPreviewFileUpdates({
    input: {
      owner: "octo",
      repo: "repo",
      branch: "main",
      files: [
        { path: ".env", content: "SECRET=x" },
        { path: "README.md", content: "hello" }
      ]
    }
  });

  assert("preview dry_run flag is true", denied_result.dry_run === true, JSON.stringify(denied_result));
  assert("preview blocks .env path", denied_result.files_denied?.some(d => d.path === ".env"), JSON.stringify(denied_result));
  assert("preview allows README.md", denied_result.files_preview?.some(p => p.path === "README.md"), JSON.stringify(denied_result));
  assert("preview would_commit false when denials exist", denied_result.would_commit === false, JSON.stringify(denied_result));
  assert("preview summary.denied count is 1", denied_result.summary?.denied === 1, JSON.stringify(denied_result));
}

section("github.js — githubGetPRStatus (validation guards)");

{
  fetchCalls.length = 0;
  const { githubGetPRStatus } = await importGithubModule("pr-status");

  let threw = false;
  try {
    await githubGetPRStatus({ input: { owner: "octo", repo: "repo" } });
  } catch (e) {
    threw = true;
    assert("missing pull_number throws invalid_request", e.code === "invalid_request", e.code);
  }
  assert("githubGetPRStatus requires pull_number", threw);
}

section("github.js — githubMergePR (draft and CI guards)");

{
  fetchCalls.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    const urlStr = String(url);
    if (urlStr.includes("/pulls/")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ number: 7, state: "open", draft: true, merged: false, mergeable: true, head: { sha: "abc" } });
        }
      };
    }
    return { ok: true, status: 200, async text() { return JSON.stringify({ check_runs: [] }); } };
  };

  const { githubMergePR } = await importGithubModule("merge-pr-draft");
  let draftThrew = false;
  try {
    await githubMergePR({ input: { owner: "octo", repo: "repo", pull_number: 7 } });
  } catch (e) {
    draftThrew = true;
    assert("merge blocks draft PR", e.code === "pr_is_draft", e.code);
  }
  assert("githubMergePR throws on draft", draftThrew);
}

{
  fetchCalls.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    const urlStr = String(url);
    if (urlStr.includes("/pulls/") && !urlStr.includes("/check-runs")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ number: 8, state: "open", draft: false, merged: false, mergeable: true, head: { sha: "def" } });
        }
      };
    }
    if (urlStr.includes("/check-runs")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ check_runs: [{ name: "ci", status: "completed", conclusion: "failure", html_url: "" }] });
        }
      };
    }
    return { ok: false, status: 500, async text() { return "{}"; } };
  };

  const { githubMergePR: mergePR2 } = await importGithubModule("merge-pr-ci");
  let ciThrew = false;
  try {
    await mergePR2({ input: { owner: "octo", repo: "repo", pull_number: 8 } });
  } catch (e) {
    ciThrew = true;
    assert("merge blocks failing CI", e.code === "ci_not_passing", e.code);
  }
  assert("githubMergePR throws on failing CI", ciThrew);
}

section("github.js — githubGitBlobChunkRead");

fetchCalls.length = 0;
globalThis.fetch = async (url, init = {}) => {
  fetchCalls.push({ url: String(url), init });
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        encoding: "base64",
        content: Buffer.from("abcdef", "utf8").toString("base64")
      });
    }
  };
};

{
  const { githubGitBlobChunkRead } = await importGithubModule("byte-offset");
  const result = await githubGitBlobChunkRead({
    input: {
      owner: "octo",
      repo: "repo",
      file_sha: "abc123",
      byte_offset: 1,
      length: 3
    }
  });

  assert("accepts byte_offset alias", result.ok === true, JSON.stringify(result));
  assert("returns byte_offset field", result.byte_offset === 1, JSON.stringify(result));
  assert("returns expected base64 chunk", result.content === Buffer.from("bcd", "utf8").toString("base64"), result.content);
  assert("preserves reported chunk length", result.length === 3, `got ${result.length}`);
assert("github fetch sends bearer auth header", fetchCalls[0]?.init?.headers?.Authorization === "Bearer test_token", JSON.stringify(fetchCalls[0]));
}

{
  fetchCalls.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    const method = String(init.method || "GET");
    const urlString = String(url);

    if (method === "GET" && urlString.includes("/git/ref/heads/main")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ref: "refs/heads/main",
            object: {
              sha: "base_commit_sha"
            }
          });
        }
      };
    }

    if (method === "GET" && urlString.includes("/git/commits/base_commit_sha")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            sha: "base_commit_sha",
            tree: {
              sha: "base_tree_sha"
            }
          });
        }
      };
    }

    if (method === "POST" && urlString.endsWith("/git/trees")) {
      return {
        ok: true,
        status: 201,
        async text() {
          return JSON.stringify({
            sha: "new_tree_sha"
          });
        }
      };
    }

    if (method === "POST" && urlString.endsWith("/git/commits")) {
      return {
        ok: true,
        status: 201,
        async text() {
          return JSON.stringify({
            sha: "commit_sha",
            html_url: "https://github.com/octo/repo/commit/commit_sha"
          });
        }
      };
    }

    if (method === "PATCH" && urlString.includes("/git/refs/heads/main")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ref: "refs/heads/main",
            object: {
              sha: "commit_sha"
            }
          });
        }
      };
    }

    return {
      ok: false,
      status: 500,
      async text() {
        return JSON.stringify({ message: `Unexpected mock request: ${method} ${urlString}` });
      }
    };
  };

  const { githubApplyFileUpdates } = await importGithubModule("apply-file-updates");
  const result = await githubApplyFileUpdates({
    input: {
      owner: "octo",
      repo: "repo",
      branch: "main",
      message: "Update README",
      files: [
        {
          path: "README.md",
          content: "hello"
        }
      ]
    }
  });

  const treeCall = fetchCalls.find(call => String(call.init?.method || "") === "POST" && String(call.url).endsWith("/git/trees"));
  const commitCall = fetchCalls.find(call => String(call.init?.method || "") === "POST" && String(call.url).endsWith("/git/commits"));
  const patchCall = fetchCalls.find(call => call.init?.method === "PATCH");
  const treeBody = JSON.parse(treeCall?.init?.body || "{}");
  const commitBody = JSON.parse(commitCall?.init?.body || "{}");
  const patchBody = JSON.parse(patchCall?.init?.body || "{}");

  assert("github apply file updates succeeds", result.ok === true, JSON.stringify(result));
  assert("github apply uses single commit tree mode", result.commit_mode === "single_commit_tree", JSON.stringify(result));
  assert("github apply creates one tree", !!treeCall, JSON.stringify(fetchCalls));
  assert("github apply includes base tree", treeBody.base_tree === "base_tree_sha", JSON.stringify(treeBody));
  assert("github apply includes file content in tree", treeBody.tree?.[0]?.content === "hello", JSON.stringify(treeBody));
  assert("github apply creates one commit", commitBody.parents?.[0] === "base_commit_sha" && commitBody.tree === "new_tree_sha", JSON.stringify(commitBody));
  assert("github apply updates branch ref once", patchBody.sha === "commit_sha", JSON.stringify(patchBody));
  assert("github apply does not use contents PUT per file", !fetchCalls.some(call => call.init?.method === "PUT"), JSON.stringify(fetchCalls));
}

{
  fetchCalls.length = 0;
  let agentBranchCreated = false;
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    const method = String(init.method || "GET");
    const urlString = String(url);

    if (method === "GET" && urlString.includes("/git/ref/heads/agent-branch") && !agentBranchCreated) {
      return {
        ok: false,
        status: 404,
        async text() {
          return JSON.stringify({ message: "Not Found" });
        }
      };
    }

    if (method === "GET" && urlString.includes("/git/ref/heads/agent-branch") && agentBranchCreated) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ref: "refs/heads/agent-branch",
            object: {
              sha: "base_commit_sha"
            }
          });
        }
      };
    }

    if (method === "GET" && urlString.includes("/git/ref/heads/main")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ref: "refs/heads/main",
            object: {
              sha: "base_commit_sha"
            }
          });
        }
      };
    }

    if (method === "POST" && urlString.endsWith("/git/refs")) {
      agentBranchCreated = true;
      return {
        ok: true,
        status: 201,
        async text() {
          return JSON.stringify({
            ref: "refs/heads/agent-branch",
            object: {
              sha: "base_commit_sha"
            }
          });
        }
      };
    }

    if (method === "GET" && urlString.includes("/git/commits/base_commit_sha")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            sha: "base_commit_sha",
            tree: {
              sha: "base_tree_sha"
            }
          });
        }
      };
    }

    if (method === "POST" && urlString.endsWith("/git/trees")) {
      return {
        ok: true,
        status: 201,
        async text() {
          return JSON.stringify({ sha: "new_tree_sha" });
        }
      };
    }

    if (method === "POST" && urlString.endsWith("/git/commits")) {
      return {
        ok: true,
        status: 201,
        async text() {
          return JSON.stringify({
            sha: "commit_sha",
            html_url: "https://github.com/octo/repo/commit/commit_sha"
          });
        }
      };
    }

    if (method === "PATCH" && urlString.includes("/git/refs/heads/agent-branch")) {
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            ref: "refs/heads/agent-branch",
            object: {
              sha: "commit_sha"
            }
          });
        }
      };
    }

    if (method === "POST" && urlString.endsWith("/pulls")) {
      return {
        ok: true,
        status: 201,
        async text() {
          return JSON.stringify({
            number: 42,
            html_url: "https://github.com/octo/repo/pull/42",
            draft: true,
            head: {
              ref: "agent-branch"
            },
            base: {
              ref: "main"
            }
          });
        }
      };
    }

    return {
      ok: false,
      status: 500,
      async text() {
        return JSON.stringify({ message: `Unexpected mock request: ${method} ${urlString}` });
      }
    };
  };

  const { githubValidatedApplyFileUpdates } = await importGithubModule("validated-apply-file-updates");
  const result = await githubValidatedApplyFileUpdates({
    input: {
      owner: "octo",
      repo: "repo",
      base_branch: "main",
      branch: "agent-branch",
      message: "Validated update",
      files: [
        {
          path: "README.md",
          content: "hello"
        }
      ]
    }
  });

  assert("github validated apply succeeds", result.ok === true, JSON.stringify(result));
  assert("github validated apply creates branch", result.branch_result?.created === true, JSON.stringify(result));
  assert("github validated apply keeps updates off base branch", result.branch === "agent-branch" && result.base_branch === "main", JSON.stringify(result));
  assert("github validated apply creates pull request", result.pull_request?.number === 42, JSON.stringify(result));
  assert("github validated apply exposes ci gate", result.validation_gate === "github_actions_on_pull_request", JSON.stringify(result));
}

{
  fetchCalls.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          encoding: "base64",
          content: Buffer.from("abcdef", "utf8").toString("base64")
        });
      }
    };
  };

  const { githubGitBlobChunkRead } = await importGithubModule("range-check");
  const result = await githubGitBlobChunkRead({
    input: {
      owner: "octo",
      repo: "repo",
      file_sha: "abc123",
      byte_offset: 20,
      length: 2
    }
  });

  assert("returns 416 for oversized byte_offset", result.statusCode === 416, JSON.stringify(result));
  assert("returns range_not_satisfiable error code", result.error?.code === "range_not_satisfiable", JSON.stringify(result));
}

delete process.env.GITHUB_TOKEN;

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL CONNECTOR TESTS PASS ✓");
  process.exit(0);
} else {
  console.error(`${failed} TEST(S) FAILED`);
  process.exit(1);
}
