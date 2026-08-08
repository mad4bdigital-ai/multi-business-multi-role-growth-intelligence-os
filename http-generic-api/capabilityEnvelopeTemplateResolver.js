import {
  createCapabilityEnvelopeFromTemplate as createCapabilityEnvelopeFromTemplateCore,
  resolveCapabilityEnvelopeTemplate as resolveCapabilityEnvelopeTemplateCore,
} from "./capabilityEnvelopeTemplateResolverCore.js";
import { runCapabilityResolutionDryRun } from "./scripts/capability-resolution-dry-run.mjs";

export * from "./capabilityEnvelopeTemplateResolverCore.js";

function scopedDryRunDeps(input = {}, deps = {}) {
  const expectedCommitSha = String(input?.context?.expected_commit_sha || "").trim().toLowerCase();
  const resourceBranch = String(input?.context?.resource_branch || input?.context?.branch || "").trim();
  const delegatedDryRun = deps.runCapabilityResolutionDryRun || runCapabilityResolutionDryRun;
  return {
    ...deps,
    runCapabilityResolutionDryRun: (args = {}) => delegatedDryRun({
      ...args,
      expectedCommitSha: expectedCommitSha || args.expectedCommitSha || "",
      resourceBranch: resourceBranch || args.resourceBranch || "",
    }),
  };
}

export async function resolveCapabilityEnvelopeTemplate(input = {}, deps = {}) {
  return resolveCapabilityEnvelopeTemplateCore(input, scopedDryRunDeps(input, deps));
}

export async function createCapabilityEnvelopeFromTemplate(input = {}, deps = {}) {
  return createCapabilityEnvelopeFromTemplateCore(input, scopedDryRunDeps(input, deps));
}
