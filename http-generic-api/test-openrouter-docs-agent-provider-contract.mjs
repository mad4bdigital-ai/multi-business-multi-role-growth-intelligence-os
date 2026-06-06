import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/210_sprint67_openrouter_docs_agent_provider_contract.sql", import.meta.url),
  "utf8"
);

assert.match(migration, /openrouter_openai_compatible/);
assert.match(migration, /openrouter_docs_agent_writer_v1/);
assert.match(migration, /openrouter_docs_agent_reviewer_v1/);
assert.match(migration, /docs_agent_openrouter_instruction_contract_v1/);
assert.match(migration, /platform_api_only/);
assert.match(migration, /platform governed API\/orchestrator only/);
assert.match(migration, /unified diff or structured docs patch/i);
assert.match(migration, /secrets_returned_to_agent, status, notes\)/);
assert.match(migration, /1, 1, 0, 0,\s*\n\s*'planned'/);
assert.match(migration, /'planned'/);
assert.match(migration, /missing_openrouter_credential_binding/);
assert.match(migration, /bridge_smoke_required_before_active/);
assert.match(migration, /OPENROUTER_API_KEY/);

assert.doesNotMatch(migration, /OPENROUTER_API_KEY\s*[:=]\s*[A-Za-z0-9_\-]{8,}/i);
assert.doesNotMatch(migration, /sk-or-v1-[A-Za-z0-9_\-]+/i);
assert.doesNotMatch(migration, /status\s*=\s*'active'\s*WHERE\s+provider_key\s*=\s*'openrouter_openai_compatible'/i);
assert.doesNotMatch(migration, /provider_dispatch_enabled['"]?\s*,\s*true/i);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

console.log("OpenRouter Docs Agent provider contract migration guard passed");
