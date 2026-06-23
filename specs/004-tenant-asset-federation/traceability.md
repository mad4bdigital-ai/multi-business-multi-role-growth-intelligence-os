# Traceability

| Requirement | Specification | Planned implementation evidence |
|---|---|---|
| Assets are shared by default | `spec.md` 2.1, FR-001–FR-002 | catalog projection and no-copy tests |
| User may create a customized version | `spec.md` 2.2, FR-003–FR-005 | explicit variant create/publish/reset tests |
| No copy for ordinary use or grant | `data-model.md` principles and migration philosophy | row-count and mutation regression tests |
| Tenant/workspace/brand/activity/role/user layers | `spec.md` context layers | container projection and path tests |
| User selects union/intersection behavior | `policy-composition-model.md` | profile selection and impact preview tests |
| Modes apply per dimension, not globally | `spec.md` FR-007–FR-009 | operator-allowlist tests |
| Denies and mandatory safety cannot be weakened | policy algebra and permissions matrix | mandatory-floor and escalation tests |
| User preferences customize their experience | `personalization-adaptation-model.md` | own-profile CRUD/history/reset tests |
| Preferences never grant authority | `permissions-matrix.md` | unauthorized candidate ranking tests |
| Variants can be user/role/workspace/brand/activity/tenant scoped | variant model | scope isolation and precedence tests |
| Shared base remains immutable | variant and permissions models | platform-base mutation denial tests |
| Tenant/user supplies credentials | `credential-installation-model.md` | opaque connection binding and no-secret tests |
| Catalog is separate from operational readiness | current state and credential model | readiness state tests |
| Pending connectors are classified rather than blindly activated | credential model and plan | connector cleanup report/readback |
| Approval-sensitive grant differs from pending request | permissions matrix | awareness field and open-hold tests |
| Runtime result is deterministic and explainable | `resolution-algorithm.md` | repeated checksum and explanation tests |
| Existing authorities remain until parity | current state, plan, rollout | shadow comparison and feature-flag tests |
| Dynamic Container Authority is reused | current state and data model | projection/closure/epoch evidence |
| Platform adapts from usage and outcomes | `growth-learning-loop.md` | proposal creation and attribution tests |
| Adaptation never silently changes authority | spec FR-019–FR-023 | Class E self-approval denial tests |
| Changes are simulated before canary | growth loop and rollout | simulation run and guardrail tests |
| Experiments are reversible | growth loop and rollout | automatic rollback tests |
| Tenant-local improvements may inform platform growth safely | promotion candidate model | privacy review and admin promotion tests |
| Cross-tenant learning/content reuse is controlled | personalization privacy section | anonymization/aggregation governance tests |
| User may inspect, dismiss, opt out, reset | personalization transparency | API and UI acceptance tests |
| APIs are OpenAPI 3.1 and resource-oriented | `api-contracts.md` | OpenAPI route coverage and contract tests |
| Architecture boundaries remain clear | `plan.md` architecture boundaries | architecture drift tests |
| Current branch is repaired before replacement | `plan.md` delivery principle | reconciliation, no-force mutation, ancestry readback |
| No provider writes during design/preview/simulation | README, credential model, growth loop | provider-call and credential-read flags remain false |

## Source-to-target traceability

| Existing authority | Target role |
|---|---|
| Shared asset tables | canonical asset content |
| `execution_policies` | legacy enforcement and policy atom bridge |
| platform policy registry/rules | target policy definitions and semantics bridge |
| specialized grants/bindings | legacy authorization bridge |
| Dynamic Container Authority | context topology, roles, bindings, epochs, base resolution |
| package variants | reusable patch/version concepts |
| user/dashboard preferences | bridge inputs to the unified user profile |
| recommendation/intent/execution telemetry | adaptive evidence |
| connections/installations/certifications | operational readiness |
| approval holds and capability envelopes | consequential-operation governance |

## Design decision traceability

| Decision | Reason |
|---|---|
| Shared assets remain canonical | avoids duplication, drift, and upgrade fan-out |
| Variants are explicit and sparse | customization without mandatory copies |
| Composition is field-typed | prevents unsafe arbitrary JSON merge |
| Preference follows authority | personalization cannot escalate access |
| Effective manifest is immutable | execution and outcome attribution remain reconstructable |
| Adaptation is proposal-driven | platform can learn without silent self-modification |
| Cutover is family-by-family | preserves rollback and exposes parity gaps |
