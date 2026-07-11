# Unified Platform Frontend — Surface Coverage Matrix

| Domain | Scope | Existing authority | Target experience | Wave | Foundation state |
|---|---|---|---|---|---|
| Authentication/onboarding | Public/Tenant | `/auth/*`, `/connect/*` | Sign-in, workspace bootstrap, guided activation | F1 | Live |
| Tenant overview/growth | Tenant | `/me/dashboard`, tenant dashboard routes | KPI, recommendations, digest, actions | F1 | Live generic adapter |
| Logical resources | Admin/Tenant | Resource API | catalog, list, get, permissions, changes, revisions | F1/F3 | Tenant live; Admin locked |
| Connections/integrations | Tenant | Connect API, app connections | connection health, credential intake, readiness | F1/F4 | Connect status live |
| Agents/GPT surfaces | Tenant/Admin | agent surface, GPT session/tool routes | deployment, tools, sessions, evidence | F1/F3/F5 | Cataloged |
| Support | Tenant/Admin | support ticket routes | inbox, detail, events, approvals, execution | F1/F3 | Tenant live |
| Local Manager | Tenant/Admin/device | Local Manager and connector routes | devices, routes, capabilities, repair, backups | F4 | Deep links live |
| Operations | Admin | operational console, runtime verification | incidents, parity, evidence, recovery | F3 | Locked pending BFF |
| Activation | Admin/Tenant | activation and guidance routes | session context, blockers, bootstrap evidence | F1/F3 | Tenant context cataloged |
| Platform graph/context | Admin | platform graph routes | explorer, validation, neighborhood | F5 | Locked pending BFF |
| Plugins/connected execution | Admin/Tenant | plugin and execution routes | catalog, smoke, certification, runs | F3 | Cataloged |
| Infrastructure | Tenant/Admin | tenant infrastructure and connector routes | databases, SSH, hosting, routes, health | F3/F4 | Cataloged |
| Repository automation | Admin | repository automation/conflict routes | plans, previews, evidence, approvals | F5 | Locked pending BFF |
| Developer/API | Developer/Admin | schema, jobs, workflows, sessions, OpenAPI | explorer, jobs, events, contracts | F5 | Cataloged |
| Governance/authority | Admin/Tenant | resource grants, capability policies | explain, grants, decisions, history | F3/F5 | Cataloged |
| Evidence/audit | all authorized | execution logs, evidence/readback routes | shared drawer/timeline | F5 | Shell state supported |

## Coverage rule

A domain is not considered complete because a navigation item exists. Completion requires live read models, scoped actions, validation, approval semantics, same-cycle readback, evidence rendering, tests, and production parity.
