#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const findings = [];
const checks = [];

function rel(...parts) {
  return path.join(repoRoot, ...parts);
}

function readText(filePath) {
  return readFileSync(rel(filePath), "utf8");
}

function addCheck(key, ok, detail, severity = "fail") {
  checks.push({ key, ok: Boolean(ok), detail, severity });
  if (!ok) findings.push({ key, severity, detail });
}

function fileExists(filePath) {
  return existsSync(rel(filePath)) && statSync(rel(filePath)).isFile();
}

function assertFile(filePath) {
  addCheck(`file:${filePath}`, fileExists(filePath), `${filePath} must exist.`);
}

function assertIncludes(filePath, needles, options = {}) {
  const text = fileExists(filePath) ? readText(filePath) : "";
  for (const needle of needles) {
    addCheck(
      `${filePath}:includes:${needle}`,
      text.includes(needle),
      `${filePath} must include ${needle}`,
      options.severity || "fail"
    );
  }
}

function listFilesRecursive(startDir, predicate = () => true) {
  const out = [];
  const root = rel(startDir);
  if (!existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(repoRoot, full).replaceAll(path.sep, "/");
      if (entry.isDirectory()) {
        if ([".git", "node_modules", "dist", "build", "coverage"].includes(entry.name)) continue;
        stack.push(full);
      } else if (predicate(relative)) {
        out.push(relative);
      }
    }
  }
  return out.sort();
}

function scanForForbiddenStrings(rootDir, forbiddenStrings, options = {}) {
  const excludedFiles = new Set(options.excludedFiles || []);
  const files = listFilesRecursive(rootDir, (file) => /\.(js|mjs|sql|md|yaml|yml|json)$/.test(file))
    .filter((file) => !excludedFiles.has(file));
  for (const forbidden of forbiddenStrings) {
    const matches = [];
    for (const file of files) {
      const text = readText(file);
      if (text.includes(forbidden)) matches.push(file);
    }
    addCheck(
      `forbidden:${forbidden}`,
      matches.length === 0,
      matches.length ? `Forbidden legacy identifier ${forbidden} found in ${matches.join(", ")}` : `Forbidden legacy identifier ${forbidden} absent.`
    );
  }
}

function checkSqlIdentifierLengths(migrationFiles) {
  const identifierPattern = /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?VIEW|CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+VIEW\s+IF\s+EXISTS)\s+`([^`]+)`/gi;
  for (const file of migrationFiles) {
    if (!fileExists(file)) continue;
    const text = readText(file);
    let match;
    while ((match = identifierPattern.exec(text))) {
      const identifier = match[1];
      addCheck(
        `${file}:identifier-length:${identifier}`,
        identifier.length <= 64,
        `${file} identifier ${identifier} length ${identifier.length}/64.`
      );
    }
  }
}

const requiredDocs = [
  "docs/ai-docs-agent-governance.md",
  "docs/change-documentation-governance.md",
  "docs/session-insight-capability-envelope-release-readiness.md",
  "docs/support-ticket-orchestration-completion.md",
  "docs/platform-completion-cleanup-readback-automation.md",
  "docs/dynamic-capability-tool-bus-v2.md",
];
for (const doc of requiredDocs) assertFile(doc);

assertIncludes("AI_Agent_Knowledge_Guide.md", [
  "Docs Agent automation",
  "Session Insight capability-envelope release-readiness chain",
]);

assertIncludes("docs/platform-completion-cleanup-readback-automation.md", [
  "no DB writes",
  "no provider calls",
  "no credential payload reads",
  "Release readiness remains the authority",
  "Tool Bus remains separate",
]);

assertIncludes("docs/support-ticket-orchestration-completion.md", [
  "Support Ticket lifecycle",
  "External Delivery",
  "no-send certification",
  "support_ticket_lifecycle_orchestrator",
]);

const requiredMigrations = [
  "http-generic-api/migrations/270_sprint68_support_ticket_lifecycle_orchestration_readback.sql",
  "http-generic-api/migrations/272_sprint68_support_ticket_lifecycle_snapshot_proposal.sql",
  "http-generic-api/migrations/273_sprint68_support_ticket_lifecycle_snapshot_record_gate.sql",
  "http-generic-api/migrations/904_sprint68_support_ticket_lifecycle_snapshot_apply_binding.sql",
  "http-generic-api/migrations/905_sprint68_support_ticket_lifecycle_snapshot_apply_policy_readback_alignment.sql",
  "http-generic-api/migrations/906_sprint68_ticket_external_delivery_completion_certification.sql",
  "http-generic-api/migrations/277_sprint68_session_insight_capability_envelope_dispatch_dry_run_review.sql",
  "http-generic-api/migrations/278_sprint68_session_insight_capability_envelope_actual_request_preflight.sql",
  "http-generic-api/migrations/279_sprint68_session_insight_capability_envelope_actual_request_dispatch.sql",
  "http-generic-api/migrations/280_sprint68_session_insight_capability_envelope_approval_gate.sql",
  "http-generic-api/migrations/281_sprint68_session_insight_capability_envelope_dispatch_readback.sql",
  "http-generic-api/migrations/282_sprint68_session_insight_capability_envelope_adapter_execution_gate.sql",
  "http-generic-api/migrations/283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql",
];
for (const migration of requiredMigrations) assertFile(migration);
checkSqlIdentifierLengths(requiredMigrations);

assertIncludes("http-generic-api/migrations/906_sprint68_ticket_external_delivery_completion_certification.sql", [
  "support_ticket_external_delivery_completion_certify",
  "no_external_send",
  "sandbox",
  "'provider_dispatch_enabled', false",
  "'live_external_send_default_enabled', false",
]);

assertIncludes("http-generic-api/migrations/904_sprint68_support_ticket_lifecycle_snapshot_apply_binding.sql", [
  "support_ticket_lifecycle_snapshot_record_apply_v1",
  "allow_no_credential_binding",
  "platform_managed_fallback",
]);

assertIncludes("http-generic-api/routes/supportTicketRoutes.js", [
  "/external-delivery/completion-certification",
  "certifySupportTicketExternalDeliveryCompletion",
]);

assertIncludes("http-generic-api/routes/platformPluginRoutes.js", [
  "/platform/orchestration/support-ticket/snapshot-propose",
  "/platform/orchestration/support-ticket/snapshot-record",
]);

assertIncludes("http-generic-api/supportTicketLifecycleSnapshotRecord.js", [
  "capability_envelope_apply_not_allowed",
  "will_mutate_ticket: false",
  "will_external_send: false",
  "will_read_credential_payload: false",
]);

assertIncludes("http-generic-api/routes/systemLayerRoutes.js", [
  "runtime_endpoint_call",
  "isTenantRegistryToolAllowedInSystemFacade",
  'pathValue === "/system/tools/call"',
]);

scanForForbiddenStrings("http-generic-api", [
  "v_session_insight_capability_envelope_actual_request_preflight_issues",
  "v_session_insight_capability_envelope_actual_request_preflight_readiness",
  "v_session_insight_capability_envelope_dispatch_readback_readiness",
  "v_session_insight_capability_envelope_adapter_execution_readiness",
  "v_session_insight_capability_envelope_adapter_execution_gate_issues",
  "v_session_insight_capability_envelope_adapter_apply_dispatch_readiness",
], {
  excludedFiles: [
    "http-generic-api/scripts/platform-completion-cleanup-readback-audit.mjs",
    "http-generic-api/scripts/platform-remaining-scope-scorecard.mjs",
  ],
});

const summary = {
  ok: findings.filter((finding) => finding.severity === "fail").length === 0,
  checked_at: new Date().toISOString(),
  mode: "static_no_secrets_no_db_no_provider_calls",
  total_checks: checks.length,
  failed_checks: findings.filter((finding) => finding.severity === "fail").length,
  findings,
  secrets_included: false,
};

console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  process.exitCode = 1;
}
