# Unified Frontend Coverage Matrix

This is a product grouping guide. The generated dispatch artifact is the operational source of truth for exact families, operations, gaps, dependencies, and owners.

| Product group | Primary repository authority | Target experience | Default wave | Completion evidence |
|---|---|---|---|---|
| Authentication/onboarding | auth, onboarding, Connect routes/assets | sign-in, bootstrap, activation guidance | F1 | auth/security/regression tests |
| Tenant overview/growth | dashboard, growth, activation awareness | KPIs, recommendations, digest, actions | F1 | scoped live read and action readback |
| Logical resources | Resource API manifest/routes | catalog, list/get/search, permissions, changes/revisions | F1/F3 | resource coverage + tenant/admin tests |
| Connections/integrations | Connect, credential, connector routes | catalog, intake, health, readiness | F1/F4 | secret redaction + connection readback |
| Agents/sessions/tools | agent/GPT/session routes | deployments, sessions, tools, evidence | F1/F3/F5 | grant/scope and evidence tests |
| Support | support ticket routes | inbox, detail, events, approvals, execution | F1/F3 | lifecycle and tenant/admin tests |
| Local Manager | Local Manager/device/route/backup sources | devices, routes, capabilities, repair, backups | F4 | trust, consent, freshness, parity |
| Operations | operational/status/verification sources | incidents, parity, recovery, evidence | F3 | Admin BFF + verification readback |
| Activation | activation surface manifests/routes | blockers, sessions, bootstrap evidence | F1/F3 | activation coverage and evidence |
| Plugins/execution | plugin and connected-execution sources | catalog, install, smoke, runs | F3 | policy, approval, certification |
| Infrastructure | tenant infrastructure/deployment/SSH/database | hosting, databases, routes, health | F3/F4 | tenant scope + safe runtime evidence |
| Repository automation | repository/conflict automation sources | plans, previews, approvals, evidence | F5 | dry-run, approval, readback |
| Developer/API/graph | OpenAPI, jobs, workflows, graph, schema | contracts, runs, graph, revisions | F5 | explicit grant + redaction |
| Governance/authority | grants, policies, access, audit sources | explain, decisions, history | F3/F5 | authority and audit evidence |
| Cutover/release | legacy assets, telemetry, deployment evidence | redirects, parity, accessible production UI | F6 | staging/production and post-merge audit |

## Non-negotiable rule

A navigation item, route, OpenAPI path, or existing HTML page alone is not coverage. A family completes only after scope, contract, product decision, authentication, tests, evidence/readback, accessibility, and production parity are all satisfied.
