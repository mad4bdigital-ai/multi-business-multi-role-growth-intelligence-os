import { getPool } from "./db.js";
import {
  PHASE1_CAPABILITY_DISCOVERY_SOURCES,
  clampDiscoveryInteger,
  loadPhase1DiscoverySource,
} from "./phase1CapabilityDiscoverySources.js";
import { analyzePhase1CapabilityRecords } from "./phase1CapabilityDiscoveryAnalysis.js";

export { analyzePhase1CapabilityRecords } from "./phase1CapabilityDiscoveryAnalysis.js";
export const PHASE1_CAPABILITY_DISCOVERY_REPORT_VERSION =
  "phase1-capability-discovery-report-v1";

export async function buildPhase1CapabilityDiscoveryReport(args = {}, deps = {}) {
  const scanLimit = clampDiscoveryInteger(args.scan_limit ?? args.scanLimit, 5000, 1, 10000);
  const outputLimit = clampDiscoveryInteger(args.limit, 100, 1, 500);
  let inventories;
  if (deps.loadSourceInventories) {
    inventories = await deps.loadSourceInventories({ scanLimit, sources: PHASE1_CAPABILITY_DISCOVERY_SOURCES });
  } else {
    const pool = deps.pool || getPool();
    inventories = await Promise.all(
      PHASE1_CAPABILITY_DISCOVERY_SOURCES.map((source) => loadPhase1DiscoverySource(pool, source, scanLimit)),
    );
  }
  return {
    ok: true,
    report_type: "phase1_capability_discovery",
    report_version: PHASE1_CAPABILITY_DISCOVERY_REPORT_VERSION,
    observed_at: deps.now ? deps.now() : new Date().toISOString(),
    freshness_class: "mysql_primary_live_read",
    scope: {
      tasks: ["T011", "T012", "T013", "T014"],
      scan_limit_per_source: scanLimit,
      output_limit_per_finding: outputLimit,
    },
    ...analyzePhase1CapabilityRecords(inventories, { limit: outputLimit }),
    separation_guarantees: {
      runtime_dispatch_performed: false,
      provider_calls_performed: false,
      credential_payloads_read: false,
      mutations_performed: false,
      secrets_included: false,
    },
    source_of_truth: {
      registry: "mysql_primary",
      tables: PHASE1_CAPABILITY_DISCOVERY_SOURCES.map((source) => source.table),
      mutation_classifier: "governedExecutionPreflight.classifyMutationPolicyRequirement",
      mutation_policy_declaration: "governedExecutionPreflight.hasDeclaredMutationPolicy",
    },
    limitations: [
      "The report inventories registry descriptors and policy metadata; it does not execute any capability.",
      "A complete result requires every source table to exist and every active row count to fit the configured scan limit.",
      "Tenant-visible administrative findings require human review because some overlaps are intentional compatibility surfaces.",
    ],
    secrets_included: false,
  };
}
