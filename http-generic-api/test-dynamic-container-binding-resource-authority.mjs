import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { resolveCanonicalContainerBindingResource } from "./dynamicContainerBindingResourceAuthority.js";

function fakeConnection(rows) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return [rows];
    },
  };
}

async function expectAuthorityError(input, rows, expectedCode) {
  const connection = fakeConnection(rows);
  await assert.rejects(
    () => resolveCanonicalContainerBindingResource(connection, input),
    (error) => error?.code === expectedCode
  );
  return connection;
}

{
  const connection = fakeConnection([]);
  const result = await resolveCanonicalContainerBindingResource(connection, {
    dimension: "assets",
    resourceType: "asset",
    resourceRef: "asset-one",
  });
  assert.equal(result, null);
  assert.equal(connection.queries.length, 0, "unmanaged resource families must remain backward-compatible");
}

{
  const connection = fakeConnection([{ agent_id: "agent-one", status: "active" }]);
  const result = await resolveCanonicalContainerBindingResource(connection, {
    dimension: "agents",
    resourceType: "agent",
    resourceRef: "agent-one",
  });
  assert.deepEqual(result, {
    resourceRef: "agent-one",
    sourceTable: "agents",
    sourcePk: "agent-one",
    authoritySource: "agents",
  });
  assert.deepEqual(connection.queries[0].params, ["agent-one"]);
  assert.match(connection.queries[0].sql, /FROM agents/);
  assert.match(connection.queries[0].sql, /LIMIT 2 FOR UPDATE/);
}

await expectAuthorityError(
  { dimension: "agents", resourceType: "agent", resourceRef: "agent-missing" },
  [],
  "container_binding_resource_not_found"
);

await expectAuthorityError(
  { dimension: "agents", resourceType: "agent", resourceRef: "agent-draft" },
  [{ agent_id: "agent-draft", status: "draft" }],
  "container_binding_resource_inactive"
);

await expectAuthorityError(
  { dimension: "agents", resourceType: "agent", resourceRef: "agent-ambiguous" },
  [
    { agent_id: "agent-ambiguous", status: "active" },
    { agent_id: "agent-ambiguous", status: "active" },
  ],
  "container_binding_resource_ambiguous"
);

{
  const connection = fakeConnection([{ workflow_id: "workflow-id", workflow_key: "workflow-key", status: "active", active: "TRUE" }]);
  const result = await resolveCanonicalContainerBindingResource(connection, {
    dimension: "workflows",
    resourceType: "workflow",
    resourceRef: "workflow-id",
  });
  assert.deepEqual(result, {
    resourceRef: "workflow-key",
    sourceTable: "workflows",
    sourcePk: "workflow-id",
    authoritySource: "workflows",
  });
  assert.deepEqual(connection.queries[0].params, ["workflow-id", "workflow-id"]);
  assert.match(connection.queries[0].sql, /workflow_id=\? OR workflow_key=\?/);
  assert.match(connection.queries[0].sql, /LIMIT 3 FOR UPDATE/);
}

await expectAuthorityError(
  { dimension: "workflows", resourceType: "workflow", resourceRef: "workflow-missing" },
  [],
  "container_binding_resource_not_found"
);

await expectAuthorityError(
  { dimension: "workflows", resourceType: "workflow", resourceRef: "workflow-disabled" },
  [{ workflow_id: "workflow-disabled", workflow_key: "workflow-disabled", status: "disabled", active: "FALSE" }],
  "container_binding_resource_inactive"
);

await expectAuthorityError(
  { dimension: "workflows", resourceType: "workflow", resourceRef: "workflow-ambiguous" },
  [
    { workflow_id: "workflow-ambiguous", workflow_key: "workflow-a", status: "active", active: "TRUE" },
    { workflow_id: "workflow-b", workflow_key: "workflow-ambiguous", status: "active", active: "TRUE" },
  ],
  "container_binding_resource_ambiguous"
);

const mutationSource = await fs.readFile(new URL("./dynamicContainerAuthorityMutationService.js", import.meta.url), "utf8");
assert.match(mutationSource, /resolveCanonicalContainerBindingResource\(connection,/);
assert.match(mutationSource, /canonicalResource\?\.resourceRef \?\? request\.resourceRef/);
assert.match(mutationSource, /canonicalResource\?\.sourceTable \?\? input\.sourceTable \?\? null/);
assert.match(mutationSource, /canonicalResource\?\.sourcePk \?\? input\.sourcePk \?\? null/);
assert.doesNotMatch(mutationSource, /input\.sourceTable \|\| null,input\.sourcePk \|\| null/);

console.log("dynamic container binding resource authority tests passed");
