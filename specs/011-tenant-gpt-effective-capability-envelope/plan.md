# Implementation Plan

## Delivery mode

`multi_pr` because additive persistence, runtime integration, migration authorization, production verification, and post-merge audit may be required.

## Phase 0 — Specification

Land this Spec Kit, confirm ownership boundaries with Specs 007/009, and complete product/security/API/localization review. No runtime change.

## Phase 1 — Read-only composition kernel

Add domain types for intent candidates, readiness vector, evidence class, contradiction result, and ECE. Add application composition over principal, resource context, Business Activity, governance manifest, connection readiness, and customer-safe projection. Expose preview-only APIs.

## Phase 2 — Questionnaire engine

Generate questions from verified schemas; persist bounded state/fingerprints; integrate localization; invalidate impacted answers on schema drift. Execution remains disabled.

## Phase 3 — Operation preflight and continuity

Integrate operation context/preflight, contradiction engine, support links, idempotent resume, and blocker-remediation retry.

## Phase 4 — Read-only pilots

Brand/resource discovery, WordPress schema discovery, analytics freshness, CRM schema, workflow inspection, and device recommendation suppression. Run shadow comparison.

## Phase 5 — Bounded mutation pilots

Separate PR/certification/approval/readback for: Brand-scoped grant, WordPress draft, bounded CRM update, and workflow run. Direct publish, spend activation, deployment, destructive operations, and device install remain later cohorts.

## Phase 6 — Migration and rollout

Apply additive migrations only after merged-PR authorization. Enable global shadow, then bounded read-only cohorts, then one mutation capability at a time.

## Phase 7 — Production verification and closeout

Verify isolation, projection, contradictions, readback, retry, localization, metrics, and unexplained shadow mismatches. Complete post-merge audit and closeout PR.

## Rollback

Disable facade exports/cohort flags; preserve evidence and operations; revert visible flow to legacy questionnaire; never delete audit/readback evidence during containment.
