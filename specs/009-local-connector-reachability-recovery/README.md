# Local Connector Runtime/Tunnel/Host Reachability Recovery

**Spec key:** `009-local-connector-reachability-recovery`  
**Status:** Draft specification; implementation pending  
**Specification branch:** `gpt/local-connector-reachability-spec-kit-20260708`  
**Delivery:** Draft PR for design review first. Runtime implementation, migrations, and production recovery flows must ship through later governed PRs.

## Purpose

This Spec Kit defines the recovery and lifecycle model for the gap observed when both Local Connector access paths failed readback:

```text
tenant auth-host path: auth.mad4b.com -> connector proxy -> device runtime
admin break-glass path: connector.mad4b.com -> device runtime / local connector admin surface
observed state: 502 / unknown / registered_route_count = 0
```

The design covers device format, Windows reinstall, device replacement, multiple devices, explicit target selection, route registration, tunnel health, host-level recovery, auto-install, and disaster recovery.

## Specification PR boundary

This PR is specification-only. It does not start services, mutate Cloudflare, rotate tokens, install software, change production routing, or repair a device. It records the target design, contracts, data model, rollout plan, tests, and completion gates.

## Relationship to recent work

This design builds on the DB-backed route lifecycle profile work introduced in PR #2357. That work made lifecycle policy dynamic by `global`, `tenant`, `user`, and `device` profile scopes. This Spec Kit defines the next layer: route registration and reachability state machines, host health separation, disaster recovery, and auto-install orchestration.

## Document index

- `SPEC_KIT_OVERVIEW_AR.md` — Arabic executive overview.
- `spec.md` — user stories, requirements, non-goals, and success criteria.
- `plan.md` — implementation strategy and phased PR plan.
- `architecture.md` — service boundaries, route channels, state machine, and data flow.
- `connection-maps.md` — Mermaid connection diagrams, trust boundaries, and failure maps.
- `usage-model.md` — optimal usage journeys, UI states, and anti-patterns.
- `data-model.md` — proposed tables, records, and retention rules.
- `decision-tables.md` — deterministic classification, target selection, and recovery decisions.
- `migration-and-compatibility.md` — additive migration and compatibility strategy.
- `operational-model.md` — diagnostics, SLOs, alerts, runbooks, and rollback.
- `risk-register.md` — deeper risk inventory, blockers, mitigations, and review questions.
- `testing-strategy.md` — unit, integration, simulation, and recovery tests.
- `threat-model.md` — abuse cases and mitigations.
- `rollout-pr-sequence.md` — safe multi-PR implementation sequence.
- `contracts/local-connector-reachability.openapi.yaml` — draft OpenAPI 3.1 contract.
- `checklists/` — requirements, security, and release-readiness gates.
- `tasks.md` and `completion.json` — governed delivery tracking.

## Current live baseline

The motivating evidence is the post-merge diagnostic state observed for device `DESKTOP-DDR0NG6` / config alias `essam-pc`:

```text
runtime URL: https://lc-c2dd912e.mad4b.com/
admin recovery URL: https://connector.mad4b.com/
connector_auth_configured: true
registered_route_count: 0
health_status: unknown
auth-host health: 502
break-glass health: 502
```

This baseline is evidence for planning only. It must not be hard-coded as an acceptance threshold.
