import fs from "node:fs";
import { handleEnvControl, handleWindowsAppControl, parseArgs, requireAdminPrincipal } from "./routes/adminCliRoutes.js";
import { inspectRepoReadOnly } from "./routes/gptToolsRoutes.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

const originalSecret = process.env.ADMIN_CONTROL_TEST_SECRET;
const originalPlain = process.env.ADMIN_CONTROL_TEST_PLAIN;

try {
  console.log("\n== admin control helpers");

  const adminCliSource = fs.readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
  assert("local connector JSON responses omit inline installer secrets",
    !adminCliSource.includes("script_content: batContent"),
    "JSON action responses must not expose generated .bat content with live credentials");
  assert("local connector JSON responses explain omitted installer secrets",
    adminCliSource.includes("script_content_omitted: true"),
    "responses should make the omission explicit");
  assert("local connector JSON responses expose sanitized Drive handoff status",
    adminCliSource.includes("drive_upload_status") && adminCliSource.includes("sanitizeDriveUploadError"),
    "responses should distinguish uploaded, failed, and unconfigured Drive handoffs without exposing installer content");
  assert("github admin control falls back to REST when gh is missing",
    adminCliSource.includes("executeGitHubRestFallback") &&
    adminCliSource.includes("gh CLI is not installed on host; used GitHub REST fallback") &&
    adminCliSource.includes("getGitHubAppInstallationToken") &&
    adminCliSource.includes("/actions/runs") &&
    adminCliSource.includes("/actions/jobs/"),
    "host GitHub control must not hard-fail when gh is absent");
  assert("github REST fallback preserves mutation error classes",
    adminCliSource.includes("github_rest_conflict") &&
    adminCliSource.includes("github_rest_validation_failed") &&
    adminCliSource.includes("github_error"),
    "GitHub 409/422 responses must remain structured and must not be flattened into opaque 502s");
  assert("github REST fallback supports PR mutation methods",
    adminCliSource.includes("parseGithubApiMethod") &&
    adminCliSource.includes("parseGithubFieldValues") &&
    adminCliSource.includes("/update-branch") &&
    adminCliSource.includes("/merge"),
    "gh api -X PUT/POST fallback should support PR update-branch and merge endpoints");
  assert("github merge fallback classifies dirty pull requests before merge",
    adminCliSource.includes("github_pr_not_mergeable_dirty") &&
    adminCliSource.includes("mergeable_state") &&
    adminCliSource.includes("Resolve conflicts or recreate the branch"),
    "dirty PRs should produce actionable 409 diagnostics before attempting merge");
  assert("github REST fallback supports gh pr view diagnostics",
    adminCliSource.includes('resource === "pr" && command === "view"') &&
    adminCliSource.includes("stateCheckRollup") &&
    adminCliSource.includes("/check-runs?per_page=100"),
    "PR view fallback should expose merge state and check rollup diagnostics");
  assert("github REST fallback supports gh pr update-branch convenience",
    adminCliSource.includes('resource === "pr" && command === "update-branch"') &&
    adminCliSource.includes("update_branch_requested") &&
    adminCliSource.includes("expected_head_sha"),
    "PR update-branch fallback should support conflict recovery attempts without gh CLI");
  assert("github dirty PR diagnostics include compare file evidence",
    adminCliSource.includes("compare_status") &&
    adminCliSource.includes("ahead_by") &&
    adminCliSource.includes("behind_by") &&
    adminCliSource.includes("filename: file.filename"),
    "dirty PR diagnostics should include compare status and changed file evidence");

  const repoList = await inspectRepoReadOnly({ action: "list", path: "http-generic-api", max_entries: 200 });
  assert("repo inspect can list repo files read-only", repoList.entries.some((entry) => entry.path === "http-generic-api/package.json"), JSON.stringify(repoList));
  const repoRead = await inspectRepoReadOnly({ action: "read", path: "http-generic-api/package.json", max_chars: 4000 });
  assert("repo inspect can read allowlisted text files", repoRead.content.includes("\"scripts\""), repoRead.content.slice(0, 200));
  const csharpRead = await inspectRepoReadOnly({ action: "read", path: "apps/local-manager-windows/Program.cs", max_chars: 4000 });
  assert("repo inspect can read C# source files", csharpRead.content.includes("Program") || csharpRead.content.includes("class"), csharpRead.content.slice(0, 200));
  const repoSearch = await inspectRepoReadOnly({ action: "search", path: "http-generic-api/routes", query: "buildGptToolsRoutes", max_entries: 5 });
  assert("repo inspect can search repository text", repoSearch.matches.some((match) => match.path.endsWith("gptToolsRoutes.js")), JSON.stringify(repoSearch));
  try {
    await inspectRepoReadOnly({ action: "read", path: "secrets/example.env" });
    assert("repo inspect blocks secret paths", false);
  } catch (error) {
    assert("repo inspect blocks secret paths", ["repo_path_blocked", "repo_file_blocked"].includes(error.code), error.message);
  }

  assert("parseArgs preserves array entries", JSON.stringify(parseArgs(["a", "b c"])) === JSON.stringify(["a", "b c"]));
  assert("parseArgs splits simple strings", JSON.stringify(parseArgs("repo list")) === JSON.stringify(["repo", "list"]));
  assert("parseArgs rejects empty input", parseArgs("").length === 0);

  handleEnvControl({ action: "set", name: "ADMIN_CONTROL_TEST_SECRET", value: "super-secret" });
  handleEnvControl({ action: "set", name: "ADMIN_CONTROL_TEST_PLAIN", value: "plain-value" });

  const maskedSecret = handleEnvControl({ action: "get", name: "ADMIN_CONTROL_TEST_SECRET" });
  const revealedSecret = handleEnvControl({ action: "get", name: "ADMIN_CONTROL_TEST_SECRET", reveal_values: true });
  const plain = handleEnvControl({ action: "get", name: "ADMIN_CONTROL_TEST_PLAIN" });
  const listed = handleEnvControl({ action: "list" });

  assert("env get masks sensitive variable names", maskedSecret.value === "[masked]", JSON.stringify(maskedSecret));
  assert("env get can reveal sensitive values when requested", revealedSecret.value === "super-secret", JSON.stringify(revealedSecret));
  assert("env get returns non-sensitive values", plain.value === "plain-value", JSON.stringify(plain));
  assert("env list includes keys", listed.keys.includes("ADMIN_CONTROL_TEST_SECRET"));

  const unset = handleEnvControl({ action: "unset", name: "ADMIN_CONTROL_TEST_PLAIN" });
  assert("env unset reports existing variable", unset.existed === true, JSON.stringify(unset));

  {
    const status = handleWindowsAppControl({ action: "status" }, { env: {}, platform: "win32" });
    assert("windows app status works before authorization", status.authorized === false && status.enabled === false, JSON.stringify(status));
    assert("windows app status explains setup", status.required_setup.includes("LOCAL_WINDOWS_APP_CONTROL_ENABLED=true"), JSON.stringify(status));
  }

  {
    try {
      handleWindowsAppControl({}, { env: {}, platform: "win32" });
      assert("windows app control disabled by default", false);
    } catch (error) {
      assert("windows app control disabled by default", error.code === "local_windows_app_control_disabled", error.message);
    }
  }

  {
    const env = {
      LOCAL_WINDOWS_APP_CONTROL_ENABLED: "true",
      LOCAL_WINDOWS_APP_ALLOWLIST: JSON.stringify({
        notepad: { display_name: "Notepad", command: "notepad.exe", args: [] }
      })
    };
    const listed = handleWindowsAppControl({ action: "list" }, { env, platform: "win32" });
    const authorized = handleWindowsAppControl({ action: "authorize" }, { env, platform: "win32" });
    assert("windows app list returns allowlisted app", listed.apps.length === 1 && listed.apps[0].alias === "notepad", JSON.stringify(listed));
    assert("windows app list does not expose command", !JSON.stringify(listed).includes("notepad.exe"), JSON.stringify(listed));
    assert("windows app authorize reports authorized", authorized.authorized === true, JSON.stringify(authorized));
  }

  {
    const env = {
      LOCAL_WINDOWS_APP_CONTROL_ENABLED: "true",
      K_SERVICE: "http-generic-api",
      LOCAL_WINDOWS_APP_ALLOWLIST: JSON.stringify({ notepad: "notepad.exe" })
    };
    try {
      handleWindowsAppControl({ action: "list" }, { env, platform: "win32" });
      assert("windows app control blocks gcloud runtime", false);
    } catch (error) {
      assert("windows app control blocks gcloud runtime", error.code === "local_windows_app_control_gcloud_blocked", error.message);
    }
  }

  {
    const env = {
      LOCAL_WINDOWS_APP_CONTROL_ENABLED: "true",
      LOCAL_WINDOWS_APP_ALLOWLIST: JSON.stringify({ notepad: "notepad.exe" })
    };
    try {
      handleWindowsAppControl({ action: "launch", app_alias: "cmd" }, { env, platform: "win32" });
      assert("windows app launch requires allowlisted alias", false);
    } catch (error) {
      assert("windows app launch requires allowlisted alias", error.code === "windows_app_not_allowlisted", error.message);
    }
  }

  {
    const env = {
      LOCAL_WINDOWS_APP_CONTROL_ENABLED: "true",
      LOCAL_WINDOWS_APP_ALLOWLIST: JSON.stringify({
        notepad: { display_name: "Notepad", command: "notepad.exe", args: [] }
      })
    };
    const spawned = [];
    const result = handleWindowsAppControl(
      { action: "launch", app_alias: "notepad" },
      {
        env,
        platform: "win32",
        spawn(command, args, options) {
          spawned.push({ command, args, options });
          return { pid: 1234, unref() {} };
        }
      }
    );
    assert("windows app launch uses allowlisted command", spawned[0]?.command === "notepad.exe", JSON.stringify(spawned));
    assert("windows app launch does not use shell", spawned[0]?.options?.shell === false, JSON.stringify(spawned));
    assert("windows app launch returns alias", result.launched === true && result.app_alias === "notepad", JSON.stringify(result));
  }

  {
    let responseStatus = null;
    let responseBody = null;
    let nextCalled = false;

    requireAdminPrincipal(
      { auth: { mode: "user_jwt", is_admin: false } },
      {
        status(status) {
          responseStatus = status;
          return this;
        },
        json(body) {
          responseBody = body;
          return this;
        }
      },
      () => {
        nextCalled = true;
      }
    );

    assert("admin guard rejects user JWT principal", nextCalled === false);
    assert("admin guard returns admin-only code", responseStatus === 403 && responseBody?.error?.code === "admin_backend_api_key_required", JSON.stringify(responseBody));
  }

  {
    let nextCalled = false;
    requireAdminPrincipal(
      { auth: { mode: "backend_api_key", is_admin: true } },
      {},
      () => {
        nextCalled = true;
      }
    );
    assert("admin guard accepts backend admin principal", nextCalled === true);
  }
} finally {
  if (originalSecret === undefined) {
    delete process.env.ADMIN_CONTROL_TEST_SECRET;
  } else {
    process.env.ADMIN_CONTROL_TEST_SECRET = originalSecret;
  }

  if (originalPlain === undefined) {
    delete process.env.ADMIN_CONTROL_TEST_PLAIN;
  } else {
    process.env.ADMIN_CONTROL_TEST_PLAIN = originalPlain;
  }
}

console.log(`\n${"-".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}

console.log("ALL ADMIN CONTROL TESTS PASS");
