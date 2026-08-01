# Spec 014 — Gemini Evidence Intake and Development Automation

## Status

Specification-only draft. This directory does not authorize runtime code, migrations, Gemini calls, Google Workspace mutations, credential changes, deployment, or production activation.

## Purpose

Define a governed evidence-intake and client-survey subsystem that uses Gemini as a multimodal extraction and recommendation provider while preserving deterministic policy, human approval, tenant/Brand isolation, audit evidence, replay safety, and manual fallback.

The Spec Kit also introduces a machine-readable development automation contract so repository automation can determine:

- which requirements exist;
- which implementation waves own them;
- which tasks are ready or blocked;
- which contracts and operation paths apply;
- which CI, security, migration, deployment, and readback gates are required;
- which authoritative evidence closes each task;
- which human decisions remain unresolved.

## Canonical artifacts

- Product and operational intent: `spec.md`
- Machine-readable delivery contract: `development-automation.json`
- Contract schema: `contracts/development-automation.schema.json`
- Work Map review: `work-map-integration.json`
- Dependency-ordered work: `tasks.md`
- Operation paths: `operation-paths.md`
- State model: `data-model.md`
- Gemini output contract: `contracts/gemini-evidence-result.schema.json`
- Draft HTTP boundary: `contracts/gemini-evidence-gateway.openapi.yaml`
- Completion state: `completion.json`

## Lifecycle

```text
Specify
→ clarify open decisions
→ approve Work Map integration
→ freeze contracts
→ generate implementation work packets
→ implement bounded PR waves
→ verify exact-head CI
→ deploy through governed paths
→ production readback
→ closeout
```

## Automation intent

`development-automation.json` is an orchestration input, not execution authority. It may be consumed by repository automation to generate plans, issues, PR scopes, checklists, status summaries, and evidence requests. Every mutation still requires the nested tool's existing authority, approvals, confirmations, exact SHA/checksum binding, and readback.

## Safety boundary

Gemini may extract, classify, summarize, embed, and propose. It must not independently approve, delete, grant access, select an ambiguous tenant/Brand, publish externally, mutate protected resources, or treat model output as authoritative evidence.
