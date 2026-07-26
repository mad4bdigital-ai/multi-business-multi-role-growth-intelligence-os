# Platform Governance Recovery and Resource Authority

Date: 2026-05-31

## Purpose

This note generalizes the failure modes seen during recent repo recovery, CI repair, connector fallback, tenant tool exposure, and CMS publishing work. The goal is to convert one-off recovery lessons into platform governance capabilities.

The core principle is:

```text
Create freely under governance.
Publish or mutate only with authority.
Recover only with evidence.
```

## Postmortem Themes

The previous recovery loops were slowed by a chain of weaknesses across diagnosis, mutation, verification, and merge:

- CI logs were not available as a concise first-class tool output.
- Local test reproduction did not match GitHub runner conditions such as shallow checkout, Ubuntu, Node version, and `set -e`.
- Some guarded runtime changes were attempted before matching test, schema, or docs coverage was present.
- Local connector and auth-host recovery paths were treated as primary paths during incidents instead of GitHub App and registry-backed routes.
- CI polling was manual and did not classify pending, skipped, cancelled, stale, or failed runs.
- Known CI failure patterns were not mapped to immediate repair actions.
- Release readiness did not fully model CI, schema guards, shallow-clone behavior, or affected-test selection.
- Large feature branches bundled unrelated surfaces, causing cascade failures.
- Some tests asserted adjacent behavior instead of the exact failing branch logic.
- Tests inherited local environment flags and produced local/CI drift.
- OpenAPI GPT schema limits were enforced late.
- Git helper code assumed full history and failed in shallow clones.
- Incident state was tracked mentally instead of in a durable state machine.
- Required checks were not separated from noisy duplicate workflow runs.
- PR creation and merge paths were not fully idempotent.
- PowerShell and file-write encoding paths created avoidable diff risk.
- Multi-file patch application was not atomic enough.
- Guarded runtime hotfixes did not have a standard template.
- Recovery sometimes used inference before obtaining exact evidence.
- Connector self-repair depended on the same auth-host path that could be degraded.

## Recovery Capability Model

Recovery should be represented explicitly after evidence in the governance chain:

```text
Platform Plugin
  -> Capability
    -> Binding
      -> Policy
        -> Resource Authority
          -> Export
            -> Dispatch
              -> Evidence
                -> Recovery / Retry / Conflict Handling
                  -> Certification / Checkpoint
```

This makes failure handling part of the platform contract, not an operator habit.

## P0 Recovery Capabilities

### GitHub CI Recovery

Required capabilities:

- `github.job_logs.get`
- `github.check_annotations.get`
- `github.ci.wait_for_sha`
- `github.ci.summarize_sha`
- `github.required_checks.summary`

Required classifications:

- `all_required_passed`
- `pending`
- `failed_with_logs`
- `cancelled_by_newer_run`
- `skipped_by_path_filter`
- `guard_failed`
- `schema_contract_failed`
- `unit_test_failed`
- `stale_run`

The log parser should return the first actionable failure block only:

```text
workflow
job
failing command
file/line when present
error excerpt
suspected category
recommended next action
```

### CI Reproduction Parity

Required capabilities:

- `repo.ci.simulate`
- `repo.shallow_clone_smoke`
- `repo.git_helper.parity_check`

Any helper using `HEAD~1`, `merge-base`, ranges, branch names, or local history must be tested under:

- full clone
- shallow clone
- detached HEAD
- explicit bad ref
- initial/no-parent commit

### Repo Patch and Error Taxonomy

Required capabilities:

- `repo.patch.error.classify`
- `repo.patch.context_recover`
- `repo.patch.no_match.diagnose`
- `repo.branch.state.resolve`
- `repo.pr.merge_state.resolve`
- `github.pr.merge_idempotent`

Core policies:

- On `repo_patch_no_match`, read the current file and re-plan before retrying.
- On missing GitHub reference, check PR state before retrying.
- If the branch was deleted after a successful merge, return `already_merged`.
- If branch-list responses are over-broad, resolve by workflow head SHA or compare API.
- Direct guarded runtime changes must include matching tests, docs, schema, or canonical evidence.

Idempotent merge workflow:

1. Read PR state.
2. If `merged=true`, return success with `already_merged=true`.
3. If closed and not merged, block.
4. If head ref is missing but PR is merged, return success.
5. Otherwise merge with expected head SHA.

### Release Readiness Gate

Release readiness must include:

- syntax guard
- schema-docs-change guard
- OpenAPI GPT schema lint
- affected unit tests
- shallow git helper smoke when git helpers changed
- guarded route coverage check
- required-check summary
- CI log summary when any check fails

DB/readiness status alone is not sufficient for merge readiness.

## Resource Authority Principle

Generating an artifact is not the same as publishing it.

```text
Generate is not publish.
Draft is not authorization.
Admin intent is not resource authority.
```

Any write to a tenant, user, brand, or externally owned resource requires:

```text
resource resolution
ownership claim
active grant
scoped credential
policy gate
audit evidence
readback
```

This applies to:

- WordPress post publish
- CMS page update
- Google Drive file write
- GitHub repo patch
- n8n workflow activation
- Cloudflare DNS change
- local connector config write
- CRM contact update
- email campaign send
- social post publish
- AI-generated asset upload

Admin users may approve, configure, repair, or certify. They should not bypass resource-scoped evidence unless an explicit break-glass path is used.

Break-glass requires:

- reason
- temporary scope
- audit
- readback
- no secret exposure

## Content and CMS Governance

Content workflows should follow:

```text
Content / Marketing Operation
  -> Brand Context
    -> Draft Generation
      -> Target Resource Resolution
        -> Claim / Ownership Check
          -> Active Grant Check
            -> Publish Gate
              -> Evidence / Audit / Readback
```

Recommended plugin families:

- `brand_content_governance`
- `cms_publish_authorization`
- `content_lifecycle_governance`

Recommended capabilities:

- `brand.content.research`
- `brand.blog.draft_generate`
- `brand.blog.seo_package`
- `brand.content.target_resource_resolve`
- `brand.content.publish_readiness_check`
- `brand.content.publish_gate`
- `brand.content.publish_evidence_readback`
- `cms.site.resolve`
- `cms.site.claim.resolve`
- `cms.site.grant.required_check`
- `cms.site.grant.active_check`
- `cms.site.grant.draft_allowed_check`
- `cms.site.grant.publish_allowed_check`
- `wordpress.draft.gate`
- `wordpress.publish.gate`

Core policies:

- Brand Core is required.
- Source content must be present or cited.
- Draft comes before publish.
- SEO metadata is required before publish readiness.
- Target resource is required.
- Publish requires an active publish-capable grant.
- Credentials must match tenant, site, and target resource.
- Legacy fallback is temporary only for not-yet-backfilled sites.
- No write happens without grant evidence.

## Tenant System Facade Governance

Tenant GPT schema expansion must not add direct admin, connector, provider-bootstrap, or platform management routes.

Tenant capability expansion should happen through registry-backed tool discovery and dispatch:

```text
activateSession
listTools
callTool
writeSessionTurn
endSession
```

Recommended plugin family:

- `tenant_system_facade_governance`

Recommended capabilities:

- `tenant.system_tools.list`
- `tenant.system_tools.call`
- `tenant.connect.status`
- `tenant.connect.activate`
- `tenant.connect.device_install`
- `tenant.local_gateway.tools_list`
- `tenant.local_gateway.tools_call`
- `tenant.tool_surface.filter_admin_routes`

Core policies:

- tenant-only
- user JWT required
- no `/admin/*`
- no `/connector/*`
- no break-glass connector routes
- tool-name allowlist required
- OpenAPI facade schema must match registry-backed tool visibility

## Credential Intake and Promotion Governance

Recommended plugin families:

- `credential_intake_enforcement`
- `credential_promotion_governance`

Distinction:

```text
enforcement = request missing secret through governed intake
promotion = move encrypted credential into governed runtime config without revealing it
```

Required policies:

- secret values are never returned
- intake is created only when the effective plan is blocked by a missing secret
- user or tenant scope is required
- schema flags are required
- audit is required

## Canonical Knowledge Governance

GPT Builder uploads are not canonical. Live repo files, SQL registries, runtime policies, and governed read surfaces are canonical.

Recommended plugin family:

- `canonical_knowledge_governance`

Recommended capabilities:

- `knowledge.repo_live_load`
- `knowledge.tenant_safe_load`
- `knowledge.source_authority.resolve`
- `knowledge.upload_drift.detect`
- `knowledge.admin_repo_access.guard`

Policies:

- Admin may use governed repo inspection.
- Tenant flows must use OAuth/user-scoped tools.
- GPT Builder uploads are non-canonical.
- Raw migrations are not tenant-visible.
- Cross-tenant diagnostics are blocked.

## Platform Plugin Canonical Model

Platform Plugin capabilities should aggregate existing authority sources instead of replacing them.

Authority source families include:

- `actions`
- `endpoints`
- `workflows`
- `logic_definitions`
- `business_activity_types`
- `task_routes`
- `brands`
- `connected_systems`
- `agent_skills`
- `agent_skill_grants`
- `local_connector_user_configs`
- `local_connector_shell_allowlists`
- `local_connector_file_access_rules`

Capability pointers should retain source identity:

```text
platform_plugin_capabilities.source_table = actions
platform_plugin_capabilities.source_key = github_actions_status
```

or:

```text
platform_plugin_capabilities.source_table = agent_skills
platform_plugin_capabilities.source_key = code.repository_automation
```

## Updated Plugin Families

The official governance family set should include:

1. `platform_plugin_core`
2. `github_ci_recovery`
3. `repo_governance`
4. `repo_patch_error_taxonomy`
5. `credential_intake_enforcement`
6. `credential_promotion_governance`
7. `local_connector_materialization`
8. `local_manager_activation_handoff`
9. `tenant_system_facade_governance`
10. `tenant_oauth_reproduction`
11. `cms_resource_governance`
12. `brand_content_governance`
13. `cms_publish_authorization`
14. `content_lifecycle_governance`
15. `database_lifecycle_governance`
16. `release_deployment_parity_governance`
17. `dr_certification`
18. `canonical_knowledge_governance`
19. `tool_discovery_governance`
20. `provider_bridge_governance`
21. `ai_model_skill_module_governance`

## Priority Update

### P0

- Platform plugin canonical schema for capabilities, bindings, exports, and source pointers.
- Tenant system facade governance.
- Credential intake enforcement.
- Credential promotion governance.
- Repo patch error taxonomy.
- GitHub CI recovery capabilities.
- Canonical knowledge governance.
- Deployment parity capability.
- CMS publish authorization.
- Brand content governance.
- Resource authority layer.
- Publish gate before credential resolution.
- Draft versus publish grant distinction.
- Content publish readback and audit.

### P1

- CMS resource governance phases.
- Local Manager new-device handoff.
- Tenant OAuth reproduction.
- Database lifecycle governance snapshots.
- PR merge idempotency capability.
- Local connector materialization validation.
- Content lifecycle registry.
- Brand content approval workflow.
- SEO package schema.
- Performance tracking after publish.
- Legacy site backfill plan.

### P2

- DR certification.
- Provider bridge governance.
- AI model, skill, and module capabilities.
- Approval-gated apply executor.
- Multi-channel publishing governance.
- Campaign orchestration.
- AI content quality evaluation.

## Implementation Rule

Do not implement these as model prompts only. Each family needs registry representation, policy gates, evidence shape, tests, and a rollout phase.

The next implementation step should be a small registry-first change, not a broad runtime rewrite.
