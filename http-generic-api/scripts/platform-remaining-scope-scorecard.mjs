#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, "docs", "auto-platform-scorecard");
const outJson = path.join(outDir, "latest.json");
const outMd = path.join(outDir, "latest.md");

function rel(...parts) { return path.join(repoRoot, ...parts); }
function exists(file) { return existsSync(rel(file)); }
function read(file) { return readFileSync(rel(file), "utf8"); }
function listRecursive(startDir, predicate = () => true) {
  const root = rel(startDir);
  if (!existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(repoRoot, full).replaceAll(path.sep, "/");
      if (entry.isDirectory()) {
        if ([".git", "node_modules", "dist", "build", "coverage"].includes(entry.name)) continue;
        stack.push(full);
      } else if (predicate(relative)) out.push(relative);
    }
  }
  return out.sort();
}
function includes(file, needle) { return exists(file) && read(file).includes(needle); }
function check(key, ok, detail, severity = "fail") { return { key, ok: Boolean(ok), detail, severity }; }
function percent(ok, total) { return total ? Math.round((ok / total) * 100) : 100; }
function summarize(name, checks) {
  const fails = checks.filter((c) => !c.ok && c.severity === "fail");
  const warns = checks.filter((c) => !c.ok && c.severity === "warn");
  const pass = checks.filter((c) => c.ok).length;
  return { name, status: fails.length ? "fail" : warns.length ? "warn" : "pass", pass, total: checks.length, score: percent(pass, checks.length), fails, warns, checks };
}
function scanForbidden(rootDir, forbidden) {
  const files = listRecursive(rootDir, (file) => /\.(js|mjs|sql|md|yaml|yml|json)$/.test(file));
  return forbidden.map((needle) => {
    const matches = files.filter((file) => read(file).includes(needle));
    return check(`forbidden:${needle}`, matches.length === 0, matches.length ? `${needle} found in ${matches.join(", ")}` : `${needle} absent`);
  });
}
function sqlIdentifiersUnderLimit(files) {
  const out = [];
  const re = /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?VIEW|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+VIEW\s+IF\s+EXISTS)\s+`([^`]+)`/gi;
  for (const file of files) {
    if (!exists(file)) continue;
    const text = read(file);
    let match;
    while ((match = re.exec(text))) {
      const identifier = match[1];
      out.push(check(`identifier:${identifier}`, identifier.length <= 64, `${file}: ${identifier} length ${identifier.length}/64`));
    }
  }
  return out;
}

const sessionMigrations = [277, 278, 279, 280, 281, 282, 283].map((n) => {
  const files = listRecursive("http-generic-api/migrations", (file) => file.includes(`${n}_sprint68_session_insight`));
  return files[0] || `http-generic-api/migrations/${n}_missing.sql`;
});
const supportMigrations = [
  "http-generic-api/migrations/270_sprint68_support_ticket_lifecycle_orchestration_readback.sql",
  "http-generic-api/migrations/272_sprint68_support_ticket_lifecycle_snapshot_proposal.sql",
  "http-generic-api/migrations/273_sprint68_support_ticket_lifecycle_snapshot_record_gate.sql",
  "http-generic-api/migrations/904_sprint68_support_ticket_lifecycle_snapshot_apply_binding.sql",
  "http-generic-api/migrations/905_sprint68_support_ticket_lifecycle_snapshot_apply_policy_readback_alignment.sql",
  "http-generic-api/migrations/906_sprint68_ticket_external_delivery_completion_certification.sql",
];
const executionMigrations = listRecursive("http-generic-api/migrations", (file) => file.includes("execution_log_full_context_evidence"));

const sections = [];
sections.push(summarize("execution_evidence_enforcement", [
  check("migration_284_exists", executionMigrations.length > 0, "Execution log full-context evidence migration exists."),
  check("logger_full_context_fields", includes("http-generic-api/executionEvidenceLogger.js", "brandEvidence") && includes("http-generic-api/executionEvidenceLogger.js", "logicEvidence") && includes("http-generic-api/executionEvidenceLogger.js", "knowledgeEvidence"), "Logger accepts full context evidence."),
  check("logger_blocks_prompt_body", includes("http-generic-api/executionEvidenceLogger.js", "prompt_cache_json") && includes("http-generic-api/executionEvidenceLogger.js", "body_json"), "Logger blocks prompt/body payload evidence leakage."),
  check("smoke_full_context", includes("http-generic-api/scripts/execution-log-runtime-evidence-smoke.mjs", "full_context") || includes("http-generic-api/scripts/execution-log-runtime-evidence-smoke.mjs", "brand_core_status"), "Runtime evidence smoke covers full context."),
]));

sections.push(summarize("tool_bus_kernel", [
  check("runtime_endpoint_call_kernel_exists", includes("http-generic-api/routes/systemLayerRoutes.js", "runtime_endpoint_call"), "Kernel runtime_endpoint_call is present."),
  check("self_recursive_guard", includes("http-generic-api/routes/systemLayerRoutes.js", "self_recursive_dispatch_blocked") || includes("http-generic-api/routes/systemLayerRoutes.js", "isTenantRegistryToolAllowedInSystemFacade"), "Self-recursive tenant wrapper guard is present."),
  check("descriptor_resolver_missing_tracked", !includes("http-generic-api", "resolveToolDescriptor") || exists("docs/dynamic-capability-tool-bus-v2.md"), "Tool Bus descriptor resolver gap is documented/tracked.", "warn"),
  check("tool_bus_doc", exists("docs/dynamic-capability-tool-bus-v2.md"), "Tool Bus v2 document exists.", "warn"),
]));

sections.push(summarize("platform_scorecard_automation", [
  check("scorecard_workflow_exists", exists(".github/workflows/platform-remaining-scope-scorecard.yml"), "Remaining-scope scorecard workflow exists."),
  check("cleanup_workflow_exists", exists(".github/workflows/platform-completion-cleanup-readback.yml"), "Completion cleanup workflow exists."),
  check("scorecard_doc_exists", exists("docs/platform-remaining-scope-automation.md"), "Remaining-scope automation doc exists."),
]));

sections.push(summarize("registry_hygiene", [
  check("registry_hygiene_doc", exists("docs/registry-lifecycle-hygiene-runbook.md"), "Registry lifecycle hygiene runbook exists.", "warn"),
  check("lifecycle_script_mentions_unclassified", includes("http-generic-api/scripts/platform-remaining-scope-scorecard.mjs", "runtime_unclassified"), "Scorecard tracks runtime_unclassified."),
  check("placeholder_script_mentions_planned", includes("http-generic-api/scripts/platform-remaining-scope-scorecard.mjs", "planned_placeholder"), "Scorecard tracks planned_placeholder."),
]));

sections.push(summarize("cms_authority", [
  check("cms_grant_tables_referenced", listRecursive("http-generic-api", (file) => /\.(js|mjs|sql)$/.test(file)).some((file) => read(file).includes("cms_site_access_grants")), "CMS site access grants are referenced."),
  check("cms_runbook", exists("docs/cms-authority-hardening-runbook.md"), "CMS authority hardening runbook exists.", "warn"),
]));

sections.push(summarize("agent_runtime_ledger", [
  check("agent_model_runs_referenced", listRecursive("http-generic-api", (file) => /\.(js|mjs|sql)$/.test(file)).some((file) => read(file).includes("agent_model_runs")), "agent_model_runs table/path is referenced.", "warn"),
  check("agent_tool_calls_referenced", listRecursive("http-generic-api", (file) => /\.(js|mjs|sql)$/.test(file)).some((file) => read(file).includes("agent_tool_calls")), "agent_tool_calls table/path is referenced.", "warn"),
  check("agent_ledger_runbook", exists("docs/agent-runtime-ledger-wiring-runbook.md"), "Agent runtime ledger runbook exists.", "warn"),
]));

sections.push(summarize("dr_and_n8n_readiness", [
  check("dr_runbook", exists("docs/dr-local-connector-certification-runbook.md"), "DR/local connector certification runbook exists.", "warn"),
  check("n8n_runbook", exists("docs/n8n-vps-migration-runbook.md"), "n8n VPS migration runbook exists.", "warn"),
  check("db_restore_alias_tracked", includes("docs/dr-local-connector-certification-runbook.md", "db_restore_certify_probe"), "DR runbook tracks db_restore_certify_probe.", "warn"),
  check("n8n_restore_alias_tracked", includes("docs/dr-local-connector-certification-runbook.md", "n8n_restore_certify_probe"), "DR runbook tracks n8n_restore_certify_probe.", "warn"),
]));

sections.push(summarize("external_delivery_graph", [
  check("external_completion_migration", exists("http-generic-api/migrations/906_sprint68_ticket_external_delivery_completion_certification.sql"), "External Delivery no-send completion certification migration exists."),
  check("external_graph_plugin_migration", exists("http-generic-api/migrations/287_sprint68_external_delivery_orchestration_graph_plugin.sql"), "External Delivery orchestration graph plugin migration exists."),
  check("external_no_send_tag_completion", exists("http-generic-api/migrations/288_sprint68_external_delivery_no_send_tool_tag_completion.sql"), "External Delivery no-send required-tool tag completion migration exists."),
  check("external_readback_service_first_class", includes("http-generic-api/platformOrchestrationReadback.js", "v_platform_orchestration_external_delivery_readiness") && includes("http-generic-api/platformOrchestrationReadback.js", "external_delivery_readiness"), "External Delivery readiness view is first-class in platform orchestration readback."),
  check("external_graph_expected_shape", includes("http-generic-api/platformOrchestrationReadback.js", "support_ticket_external_delivery_orchestrator") && includes("http-generic-api/migrations/287_sprint68_external_delivery_orchestration_graph_plugin.sql", "expected_stage_count"), "External Delivery graph has explicit seven-stage/six-edge readiness expectations."),
  check("no_live_send_guard", includes("http-generic-api/migrations/287_sprint68_external_delivery_orchestration_graph_plugin.sql", "no_external_send") && includes("http-generic-api/migrations/287_sprint68_external_delivery_orchestration_graph_plugin.sql", "live_external_send_enabled',false"), "External Delivery graph remains no-send/live-send-disabled guarded."),
]));

const forbiddenChecks = scanForbidden("http-generic-api", [
  "v_session_insight_capability_envelope_actual_request_preflight_issues",
  "v_session_insight_capability_envelope_actual_request_preflight_readiness",
  "v_session_insight_capability_envelope_dispatch_readback_readiness",
  "v_session_insight_capability_envelope_adapter_execution_readiness",
  "v_session_insight_capability_envelope_adapter_execution_gate_issues",
  "v_session_insight_capability_envelope_adapter_apply_dispatch_readiness",
]);
sections.push(summarize("mysql_identifier_regression_guard", [
  ...sqlIdentifiersUnderLimit([...supportMigrations, ...sessionMigrations, ...executionMigrations]),
  ...forbiddenChecks,
]));

const hardFailCount = sections.reduce((sum, section) => sum + section.fails.length, 0);
const warnCount = sections.reduce((sum, section) => sum + section.warns.length, 0);
const passCount = sections.filter((section) => section.status === "pass").length;
const result = {
  ok: hardFailCount === 0,
  status: hardFailCount ? "fail" : warnCount ? "warn" : "pass",
  checked_at: new Date().toISOString(),
  mode: "static_repository_scorecard_no_secrets_no_db_no_provider_calls",
  section_count: sections.length,
  pass_sections: passCount,
  warn_count: warnCount,
  hard_fail_count: hardFailCount,
  sections,
  safety: {
    db_writes: false,
    migrations_applied: false,
    provider_calls: false,
    credential_payload_reads: false,
    external_writes: false,
    workflow_dispatch: false,
    ticket_mutation: false,
    approval_decision: false,
    deploy_or_publish: false,
    secrets_included: false,
  },
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outJson, `${JSON.stringify(result, null, 2)}\n`);
const md = [
  "# Platform Remaining Scope Scorecard",
  "",
  `Generated: ${result.checked_at}`,
  "",
  `Status: **${result.status}**`,
  "",
  "| Section | Status | Score | Fails | Warns |",
  "|---|---:|---:|---:|---:|",
  ...sections.map((section) => `| ${section.name} | ${section.status} | ${section.score}% | ${section.fails.length} | ${section.warns.length} |`),
  "",
  "## Safety",
  "",
  "This scorecard is static repository analysis only: no DB writes, no migrations, no provider calls, no credential payload reads, no external writes, no ticket mutation, no approval decision, and no deploy/publish.",
  "",
  "## Findings",
  "",
  ...sections.flatMap((section) => [
    `### ${section.name}`,
    "",
    ...section.checks.filter((c) => !c.ok).map((c) => `- **${c.severity}** ${c.key}: ${c.detail}`),
    ...(section.checks.some((c) => !c.ok) ? [] : ["- No findings."]),
    "",
  ]),
].join("\n");
writeFileSync(outMd, `${md}\n`);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
