import assert from "node:assert/strict";

import {
  readHostBreakglassRun,
  __hostBreakglassTest,
} from "./hostBreakglassCatalog.js";

/*
 * A Staging local handoff is authoritative local state.
 * Reading it must not invoke the GitHub broker.
 */
const localCorrelation = "staging-local-readback-regression";

__hostBreakglassTest.RUNS.clear();

__hostBreakglassTest.RUNS.set(localCorrelation, {
  ok: true,
  contract: "mad4b.host-breakglass-local-handoff.v1",
  correlation_id: localCorrelation,
  plan_sha256: "a".repeat(64),
  status: "local_execution_required",
  environment_key: "staging_local_windows_docker",
  required_platform: "win32",
  required_runtime: "docker_compose",
  command:
    "npm run host-breakglass:local -- --request-file <verified-request.json>",
  workflow_dispatch_performed: false,
  database_mutation_performed: false,
  secrets_included: false,
});

let unexpectedBrokerCall = false;

const localReadback = await readHostBreakglassRun(
  localCorrelation,
  {
    catalog: {
      repository:
        "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      workflow: "runtime-breakglass.yml",
      dispatch_ref: "main",
    },
    env: {},
    tokenResolver: async () => {
      unexpectedBrokerCall = true;
      throw new Error("GitHub token resolver must not run.");
    },
    fetchImpl: async () => {
      unexpectedBrokerCall = true;
      throw new Error("GitHub fetch must not run.");
    },
  },
);

assert.equal(localReadback.ok, true);
assert.equal(localReadback.status, "local_execution_required");
assert.equal(localReadback.workflow_dispatch_performed, false);
assert.equal(localReadback.durable_github_readback, false);
assert.equal(unexpectedBrokerCall, false);

/*
 * Hostinger host-local receipts are outside this Staging fast-path.
 * They must continue through the broker-backed readback path.
 */
__hostBreakglassTest.RUNS.clear();

__hostBreakglassTest.RUNS.set("production-host-local-readback-scope", {
  ok: true,
  contract: "mad4.host-breakglass-host-local-handoff.v1",
  correlation_id: "production-host-local-readback-scope",
  plan_sha256: "b".repeat(64),
  status: "host_local_execution_required",
  environment_key: "production_hostinger_autodeploy",
  workflow_dispatch_performed: false,
  database_mutation_performed: false,
  secrets_included: false,
});

let hostLocalBrokerResolverCalled = false;
const hostLocalReadback = await readHostBreakglassRun(
  "production-host-local-readback-scope",
  {
    catalog: {
      repository:
        "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      workflow: "runtime-breakglass.yml",
      dispatch_ref: "main",
    },
    env: {},
    tokenResolver: async () => {
      hostLocalBrokerResolverCalled = true;
      return "fixture-installation-token";
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { workflow_runs: [] };
      },
    }),
  },
);

assert.equal(hostLocalBrokerResolverCalled, true);
assert.equal(hostLocalReadback.status, "not_found");
assert.equal(hostLocalReadback.durable_github_readback, true);

/*
 * A genuine GitHub-backed readback must forward the catalog's
 * server-owned repository binding into the GitHub App resolver.
 */
__hostBreakglassTest.RUNS.clear();

let resolverInput = null;

const githubReadback = await readHostBreakglassRun(
  "github-repository-forwarding-regression",
  {
    catalog: {
      repository:
        "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      workflow: "runtime-breakglass.yml",
      dispatch_ref: "main",
    },
    env: {},
    tokenResolver: async (input) => {
      resolverInput = input;
      return "fixture-installation-token";
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { workflow_runs: [] };
      },
    }),
  },
);

assert.deepEqual(
  resolverInput?.repository,
  {
    owner: "mad4bdigital-ai",
    repo: "multi-business-multi-role-growth-intelligence-os",
  },
);

assert.equal(githubReadback.ok, false);
assert.equal(githubReadback.status, "not_found");
assert.equal(githubReadback.durable_github_readback, true);

console.log("host-breakglass-local-readback: PASS");
