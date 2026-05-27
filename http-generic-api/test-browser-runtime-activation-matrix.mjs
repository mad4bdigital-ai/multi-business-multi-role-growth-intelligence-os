import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('migrations/145_sprint65_browser_runtime_activation_matrix.sql', 'utf8');

assert(migration.includes("browser4_essam_v1"), 'migration must include Browser4 runtime');
assert(migration.includes("`status` = 'active'"), 'Browser4 must be promoted to active after smoke evidence');
assert(migration.includes('browser4_policy_smoke_after_identity_repair_20260527_0131'), 'Browser4 activation must retain smoke evidence');
assert(migration.includes('requires_connector_upgrade":false'), 'Browser4 metadata must no longer require connector upgrade after smoke');
assert(migration.includes("browser4_extraction_essam','browser4_inspect_essam"), 'Browser4 bindings must be active');

assert(migration.includes('auto_browser_essam_v1'), 'migration must include Auto Browser');
assert(migration.includes('visual_takeover'), 'Auto Browser must retain visual takeover classification');
assert(migration.includes('activation_pending_adapter_poc'), 'Auto Browser/Vessel must require adapter PoC before active');
assert(migration.includes('human_takeover_approval'), 'visual takeover policy must require human takeover approval');
assert(migration.includes('no_destructive_actions_without_approval'), 'visual takeover policy must block destructive actions without approval');

assert(migration.includes('vessel_browser_essam_v1'), 'migration must include Vessel Browser');
assert(migration.includes('persistent_authenticated_session'), 'Vessel must retain persistent session use case');
assert(migration.includes('session_reuse_approval_required'), 'Vessel policy must require session reuse approval');
assert(migration.includes('no_cookie_token_echo'), 'Vessel policy must forbid cookie/token echo');

assert(migration.includes('oxylabs_browser_agent_v1'), 'migration must include Oxylabs Browser Agent');
assert(migration.includes('credential_required_pending_poc'), 'Oxylabs must require credentials and PoC before active');
assert(migration.includes('public_data_only'), 'Oxylabs policy must remain public-data-only');
assert(migration.includes('cost_controls_required'), 'Oxylabs policy must require cost controls');

assert(migration.includes('cloak_browser_candidate_v1'), 'migration must include CloakBrowser candidate');
assert(migration.includes('candidate_under_review_pending_poc'), 'CloakBrowser must stay under review pending PoC');

assert(!migration.includes("UPDATE `browser_runtime_registry`\n   SET `status` = 'active'\n WHERE `runtime_key` = 'auto_browser_essam_v1'"), 'Auto Browser must not be marked active without smoke');
assert(!migration.includes("UPDATE `browser_runtime_registry`\n   SET `status` = 'active'\n WHERE `runtime_key` = 'vessel_browser_essam_v1'"), 'Vessel must not be marked active without smoke');
assert(!migration.includes("UPDATE `browser_runtime_registry`\n   SET `status` = 'active'\n WHERE `runtime_key` = 'oxylabs_browser_agent_v1'"), 'Oxylabs must not be marked active without credentials/smoke');

console.log('browser runtime activation matrix migration tests passed');
