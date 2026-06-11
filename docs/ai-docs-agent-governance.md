# AI Docs Agent Governance

## Purpose

The Docs Agent keeps repository documentation aligned with runtime, schema, tenant, deployment, and governance changes. It runs in GitHub Actions and produces reviewable Markdown evidence instead of silently changing production behavior.

The agent is designed to keep documentation updates auto-mergeable end-to-end without giving the agent permission to mutate secrets, live databases, or protected branches directly.

## Operating modes

### Pull request mode

On internal pull requests targeting `main`, the workflow:

1. Checks out the PR branch.
2. Runs `http-generic-api/scripts/docs-agent-runner.mjs --write`.
3. Writes or updates `docs/auto-docs-agent/pr-<number>.md`.
4. Commits the generated note back to the PR branch.
5. Enables GitHub auto-merge only when the PR has the explicit `docs-agent-automerge` label.

The PR author remains responsible for high-risk runtime changes. The generated note makes required documentation targets explicit and helps keep CI green.

### Main follow-up mode

On pushes to `main`, the workflow:

1. Compares the merged commit range.
2. Generates an impact note when non-doc files changed.
3. Opens a docs-only follow-up PR from `docs-agent/<sha>`.
4. Requests GitHub auto-merge for that docs-only PR.

This mode handles commits that reached `main` before a complete documentation note existed. The follow-up PR is docs-only and therefore safe for automated merge after CI passes.

## Safety boundaries

The Docs Agent must not:

- write to `main` directly
- modify `.env`, credentials, tokens, or secret payloads
- run live DB mutations
- alter generated canonical roots without canonical source changes
- mark deployment complete without runtime evidence
- merge high-risk runtime PRs without an explicit `docs-agent-automerge` label

The generated files are evidence, not authority. For high-risk changes, maintainers must still update the targeted docs named by the impact note.

For the Session Insight capability-envelope chain, generated impact notes for migrations `277` through `283` are satisfied by the targeted runbook `docs/session-insight-capability-envelope-release-readiness.md`, the patch index, deployment parity checklist, agent guide, and OpenAPI route coverage. The docs evidence confirms gated no-execution behavior only; it does not authorize adapter apply or production target writes.

## Classifier behavior

The classifier is deterministic and dependency-free. It maps changed files into impact families such as:

- `runtime_routes`
- `database_migration`
- `credential_or_auth`
- `deployment_runtime`
- `tenant_gpt`
- `admin_gpt`
- `canonical_sources`
- `openapi_schema`
- `docs_agent`

Each family maps to required documentation targets and risk level. The generated note records changed files, required docs, docs missing from the diff, and a short recommendation.

## Optional AI layer

The current implementation is deterministic so the workflow remains reliable without external model credentials. OpenRouter is the priority model provider candidate for the first model-backed drafting layer because it can be exposed through an OpenAI-compatible, platform-managed bridge.

The OpenRouter contract is tracked in `docs/openrouter-docs-agent-provider-contract.md` and registry key `docs_agent_openrouter_instruction_contract_v1`. It must keep these guardrails:

- model output must be converted into a normal Git diff
- all model calls must go through the Growth Intelligence Platform governed API/orchestrator
- no direct OpenRouter calls from the agent
- no direct `main` writes
- no secret ingestion or emission
- no live provider calls from untrusted fork PRs
- docs-only follow-up PRs remain the auto-merge unit
- provider status remains `planned` until platform credential binding and bridge smoke validation pass

## Auto-merge contract

A docs PR is auto-mergeable only when:

1. The diff is limited to generated documentation notes or approved docs files.
2. CI passes.
3. GitHub branch protection accepts the checks.
4. The workflow used GitHub auto-merge rather than bypassing review/branch protection.

High-risk code PRs can be made auto-mergeable by label only after the repository owner has approved that behavior for the PR.

## Files

```text
.github/workflows/docs-agent.yml
http-generic-api/scripts/docs-impact-classifier.mjs
http-generic-api/scripts/docs-agent-runner.mjs
http-generic-api/test-docs-impact-classifier.mjs
docs/auto-docs-agent/README.md
docs/ai-docs-agent-governance.md
```
