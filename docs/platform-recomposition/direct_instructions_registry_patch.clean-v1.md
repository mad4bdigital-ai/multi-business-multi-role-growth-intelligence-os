# direct_instructions_registry_patch.clean-v1

Clean-room staging overlay for direct platform instructions.

This file is not runtime authority yet. It reconciles the direct instruction layer with the current SQL-primary runtime.

## 1. Authority rules

- SQL registry rows are runtime authority.
- Root canonical markdown files are generated indexes.
- Canonical source files under `canonicals/` are instruction authority after promotion.
- Drive and Sheets are recovery/diagnostic/helper surfaces unless a SQL row explicitly binds them as knowledge or write targets.
- No action key or endpoint key may be invented by the assistant or runtime.

## 2. Forbidden routing shortcuts

The following labels are not executable parent action keys:

- `activation_bootstrap`
- `hard_activation_wrapper`
- `connect`
- `google_drive_probe`
- `http_get`
- `http_post`

Use registry-resolved action/endpoint rows only.

## 3. Runtime enforcement expectations

A feature is not considered fully restored until all layers agree:

1. canonical instruction exists;
2. schema/state contract exists;
3. SQL table/row contract exists;
4. runtime module is wired;
5. validation/readback passes;
6. observability records the run;
7. release readiness accepts the state.

## 4. Drift classification

| Evidence | Classification |
|---|---|
| file/table exists but runtime not wired | `validating` |
| schema/client mismatch | `degraded_contract` |
| missing route/action/workflow authority | `blocked` |
| provider unreachable but non-runtime helper only | `degraded_optional_surface` |
| same-cycle validation complete | `active` |

Recovered classification is forbidden without same-cycle validation.

## 5. Brand and business context

Brand writing requires Brand Core first. Business-type or brand-path mutations require resolver rows first.

Resolution order:

1. business activity type;
2. business type path;
3. brand under business type path;
4. brand registry and Brand Core;
5. logic pointer;
6. knowledge profile;
7. task route and workflow;
8. action/endpoint/schema.

## 6. Memory schema repair

The clean memory schema must restore the missing state properties:

- `output_artifacts_state`
- `sink_dispatch_state`
- `agent_chain_state`
- `local_connector_governance_state`

These must be placed inside both `required[]` and `properties{}` in valid JSON.

## 7. Secrets

Do not store plaintext secrets in runtime config JSON. Use secret references:

- `client_secret_ref`
- `key_secret_ref`
- `private_key_secret_ref`
- `api_key_secret_ref`

Inline secret fields must be migrated behind secret refs before being treated as compliant.

## 8. Workbooks

Production Drive workbooks are important historical and recovery assets, but direct instructions must not instruct runtime to read them as primary authority. For every workbook surface, decide one of:

- SQL mirror authority;
- recovery-only;
- human audit surface;
- deprecated/archived;
- registered write target.

## 9. Promotion guard

No staged instruction is promoted until the implementation issue it references is either fixed, explicitly classified as optional, or marked as blocked with owner and repair path.
