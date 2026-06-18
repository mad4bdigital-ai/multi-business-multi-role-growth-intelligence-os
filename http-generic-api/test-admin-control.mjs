import fs from "node:fs";
import {
  buildLocalConnectorDeviceAliasCandidates,
  buildLocalConnectorDeviceIdentityResolution,
  buildLocalConnectorTunnelProvisioningContinuationEvidence,
  buildGithubFallbackContinuationEvidence,
  handleEnvControl,
  handleWindowsAppControl,
  parseArgs,
  parseGithubPrAddLabelArgs,
  requireAdminPrincipal,
} from "./routes/adminCliRoutes.js";
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
  assert("local connector missing tunnel token returns continuation handoff",
    adminCliSource.includes("buildLocalConnectorTunnelProvisioningContinuationEvidence") &&
    adminCliSource.includes("connector_tunnel_provisioning_required") &&
    adminCliSource.includes("required_next_action: \"provision_tunnel_token\"") &&
    adminCliSource.includes("continuation") &&
    adminCliSource.includes("secrets_included: false"),
    "missing cf_token/CLOUDFLARE_TUNNEL_TOKEN should be resumable and must not be a dead-end 404");
  const localConnectorMigrationName = "233_sprint68_local_connector_tunnel_provisioning_continuation_policy.sql";
  const localConnectorMigration = fs.readFileSync(new URL(`./migrations/${localConnectorMigrationName}`, import.meta.url), "utf8");
  const migrationRunnerSource = fs.readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
  const releaseReadinessSource = fs.readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");
  assert("local connector provisioning migration registers blocking policy",
    localConnectorMigration.includes("Local Connector Tunnel Provisioning Continuation Contract") &&
    localConnectorMigration.includes("connector_tunnel_provisioning_required") &&
    localConnectorMigration.includes("return_dead_end_404_for_no_tunnel_token") &&
    localConnectorMigration.includes("secrets_included',false") &&
    migrationRunnerSource.includes(localConnectorMigrationName) &&
    releaseReadinessSource.includes(localConnectorMigrationName),
    "migration 233 must be allowlisted and tracked in release readiness");
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
  assert("github REST fallback supports gh workflow list after capability repair",
    adminCliSource.includes('resource === "workflow" && ["list", "ls"].includes(command)') &&
    adminCliSource.includes("/actions/workflows?per_page=100&page=") &&
    adminCliSource.includes("formatGithubWorkflowList") &&
    adminCliSource.includes('operation: "workflow list"') &&
    adminCliSource.includes("repaired missing capability and used GitHub REST fallback for workflow list"),
    "workflow list fallback should support active-only/default output, --all, --limit, and --json without gh CLI");

  const completedGithubFallback = buildGithubFallbackContinuationEvidence({
    args: ["workflow", "list", "--repo", "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"],
    mapped: true,
  });
  assert("successful github fallback continuation is completed without drift",
    completedGithubFallback.checkpoint.status === "completed" &&
    completedGithubFallback.checkpoint.current_stage === "completed" &&
    completedGithubFallback.checkpoint.requires_reconciliation_before_resume === false &&
    completedGithubFallback.resume_plan.risk.classification === "clean" &&
    completedGithubFallback.resume_plan.risk.resume_allowed === true &&
    completedGithubFallback.resume_plan.operation_completed === true &&
    completedGithubFallback.resume_plan.next_required_step === "none",
    "a successful mapped fallback must not remain pending or report resource_fingerprint_changed_after_interruption");

  const unsupportedGithubFallback = buildGithubFallbackContinuationEvidence({
    args: ["workflow", "unsupported"],
    mapped: false,
  });
  assert("unsupported github fallback continuation remains pending reconciliation",
    unsupportedGithubFallback.checkpoint.status === "pending_resume" &&
    unsupportedGithubFallback.checkpoint.requires_reconciliation_before_resume === true &&
    unsupportedGithubFallback.resume_plan.operation_completed !== true,
    "an unmapped operation must keep the shared reconciliation handoff");

  assert("github workflow list fallback maps official JSON fields",
    adminCliSource.includes("id: workflow.id") &&
    adminCliSource.includes("name: workflow.name") &&
    adminCliSource.includes("path: workflow.path") &&
    adminCliSource.includes("state: workflow.state") &&
    adminCliSource.includes('workflow.state === "active"'),
    "workflow list fallback must expose id/name/path/state and hide disabled workflows unless --all is present");

  assert("github REST fallback supports gh pr list after capability repair",
    adminCliSource.includes('resource === "pr" && command === "list"') &&
    adminCliSource.includes("/pulls?") &&
    adminCliSource.includes("capability_repair") &&
    adminCliSource.includes("repaired missing capability"),
    "PR list fallback should be mapped instead of forcing manual REST API calls");
  assert("github REST fallback unsupported operations include governance evidence",
    adminCliSource.includes("buildGithubFallbackUnsupportedError") &&
    adminCliSource.includes("repair_missing_capability_before_fallback") &&
    adminCliSource.includes("max_repair_attempts_before_fallback: 3") &&
    adminCliSource.includes("repair_attempts: buildGithubFallbackRepairAttempts") &&
    adminCliSource.includes("continuation: buildGithubFallbackContinuationEvidence") &&
    adminCliSource.includes("fallback_reason"),
    "unsupported fallback must carry repair-before-fallback policy evidence");
  assert("github fallback continuation uses shared reconciliation engine",
    adminCliSource.includes("createContinuationCheckpoint") &&
    adminCliSource.includes("planContinuationResume") &&
    adminCliSource.includes("github_rest_fallback_operation") &&
    adminCliSource.includes("fallback_unsupported_command") &&
    adminCliSource.includes("scope_type: \"repository\""),
    "fallback continuation must use the shared checkpoint/risk contract");
  assert("github fallback records exactly three repair attempt stages",
    adminCliSource.includes("GITHUB_FALLBACK_REPAIR_ATTEMPT_SEQUENCE") &&
    adminCliSource.includes("classify_missing_capability") &&
    adminCliSource.includes("attempt_native_capability_expansion_or_mapping") &&
    adminCliSource.includes("run_targeted_regression_test") &&
    adminCliSource.includes("repair_attempt_count: 3"),
    "fallback repair evidence must expose three governed attempts before fallback");
  assert("github REST fallback writes capability repair audit ledger",
    adminCliSource.includes("buildGithubCapabilityRepairAuditPayload") &&
    adminCliSource.includes("auditGithubFallbackCapabilityRepair") &&
    adminCliSource.includes("connector.capability_repair_fallback") &&
    adminCliSource.includes("github_rest_fallback") &&
    adminCliSource.includes("secrets_included: false"),
    "fallback capability repair events must be auditable without exposing secrets");
  assert("github REST fallback core is wrapped by audit ledger",
    adminCliSource.includes("executeGitHubRestFallbackCore") &&
    adminCliSource.includes("const result = await executeGitHubRestFallbackCore(args)") &&
    adminCliSource.includes("if (result?.fallback) auditGithubFallbackCapabilityRepair") &&
    adminCliSource.includes("if (error?.code === \"github_rest_fallback_unsupported_args\") auditGithubFallbackCapabilityRepair"),
    "fallback execution must audit both repaired fallback results and unsupported gaps");
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
  assert("github REST fallback exposes governed PR label mutation",
    adminCliSource.includes('resource === "pr" && command === "edit"') &&
    adminCliSource.includes('/issues/${encodeURIComponent(parsed.pr_number)}/labels') &&
    adminCliSource.includes("github_pr_label_requires_closed_pr") &&
    adminCliSource.includes("github_pr_label_readback_failed") &&
    adminCliSource.includes("readback_verified: true") &&
    adminCliSource.includes('GITHUB_REST_FALLBACK_PR_LABEL_ALLOWLIST = new Set(["superseded"])'),
    "PR label fallback must remain closed-PR only, allowlisted, and same-cycle readback verified");

  const parsedSupersededLabel = parseGithubPrAddLabelArgs([
    "pr", "edit", "1579", "--repo", "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os", "--add-label", "superseded",
  ]);
  assert("github PR label parser accepts one governed superseded label",
    parsedSupersededLabel?.pr_number === "1579" && parsedSupersededLabel?.label === "superseded" && parsedSupersededLabel?.secrets_included === false,
    JSON.stringify(parsedSupersededLabel));
  const parsedEqualsLabel = parseGithubPrAddLabelArgs([
    "pr", "edit", "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/1579",
    "--repo=mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os", "--add-label=superseded",
  ]);
  assert("github PR label parser accepts exact equals-form arguments",
    parsedEqualsLabel?.pr_number === "1579" && parsedEqualsLabel?.label === "superseded",
    JSON.stringify(parsedEqualsLabel));
  assert("github PR label parser ignores unrelated gh operations",
    parseGithubPrAddLabelArgs(["pr", "view", "1579"]) === null);

  for (const [label, args, expectedCode] of [
    ["rejects non-allowlisted labels", ["pr", "edit", "1579", "--add-label", "migration"], "github_pr_label_not_allowlisted"],
    ["rejects extra flags", ["pr", "edit", "1579", "--add-label", "superseded", "--body", "unexpected"], "github_pr_label_unsupported_arg"],
    ["rejects duplicate labels", ["pr", "edit", "1579", "--add-label", "superseded", "--add-label", "superseded"], "github_pr_label_value_invalid"],
    ["requires a label", ["pr", "edit", "1579", "--repo", "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"], "github_pr_label_required"],
  ]) {
    try {
      parseGithubPrAddLabelArgs(args);
      assert(`github PR label parser ${label}`, false, "expected parser rejection");
    } catch (error) {
      assert(`github PR label parser ${label}`, error?.code === expectedCode, String(error?.code || error?.message));
    }
  }

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

  const aliasCandidates = buildLocalConnectorDeviceAliasCandidates("Essam");
  assert("local connector alias candidates include normalized hostname",
    aliasCandidates.includes("essam") && aliasCandidates.includes("essam-pc"),
    JSON.stringify(aliasCandidates));
  const reverseAliasCandidates = buildLocalConnectorDeviceAliasCandidates("essam-pc");
  assert("local connector alias candidates include host without pc suffix",
    reverseAliasCandidates.includes("essam") && reverseAliasCandidates.includes("essam-pc"),
    JSON.stringify(reverseAliasCandidates));
  const identityResolution = buildLocalConnectorDeviceIdentityResolution({
    requestedUserId: "00000000-0000-4000-a000-000000000002",
    requestedDeviceId: "Essam",
    matchSource: "db_alias",
    row: {
      config_id: "8db63b00-4fce-11f1-b256-614c56cd019b",
      user_id: "f242960c-2857-4b4d-a504-ee50f8a278b4",
      device_id: "essam-pc",
      cf_tunnel_id: "f85825dd-5a0d-4e37-ad57-2d229b7eb0d6",
      cf_tunnel_name: "f242960c-2857-4b4d-a504-ee50f8a2-mohammedlap-connector",
    },
  });
  assert("local connector identity resolution is no-secret and explicit",
    identityResolution.status === "resolved_via_alias" &&
    identityResolution.requested_device_id === "Essam" &&
    identityResolution.resolved_device_id === "essam-pc" &&
    identityResolution.secrets_included === false &&
    !JSON.stringify(identityResolution).includes("cf_token"),
    JSON.stringify(identityResolution));
  assert("local connector self-repair exposes alias evidence",
    adminCliSource.includes("deviceIdentityResolution") &&
    adminCliSource.includes("resolved_device_id") &&
    adminCliSource.includes("configSource === \"db_alias\"") &&
    adminCliSource.includes("localConnectorDeviceAliasLikePatterns"),
    "self-repair should resolve Essam -> essam-pc before returning connector_tunnel_provisioning_required");

  const connectorContinuation = buildLocalConnectorTunnelProvisioningContinuationEvidence({
    userId: "00000000-0000-4000-a000-000000000002",
    deviceId: "Essam",
    tunnelStatus: null,
    cfTunnelId: null,
    tunnelUrl: null,
    configSource: "env",
  });
  assert("local connector continuation uses shared reconciliation engine",
    connectorContinuation.checkpoint.engine === "shared-reconciliation-continuation-v1" &&
    connectorContinuation.checkpoint.interruption_signal === "connector_tunnel_provisioning_required" &&
    connectorContinuation.checkpoint.resource_scope.scope_type === "device" &&
    connectorContinuation.resume_plan.next_required_step === "provision_tunnel_token" &&
    connectorContinuation.provisioning.required_next_action === "provision_tunnel_token",
    JSON.stringify(connectorContinuation));
  assert("local connector continuation excludes secrets",
    connectorContinuation.secrets_included === false &&
    connectorContinuation.checkpoint.secrets_included === false,
    JSON.stringify(connectorContinuation));

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
