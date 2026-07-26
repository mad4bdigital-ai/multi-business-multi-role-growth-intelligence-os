# Spec Kit 006 — Platform Dynamic Workflow Runtime

Status: **ready for review**  
Created: 2026-06-27  
Base commit: `a58da2b2dbd48272bdf3d83747c78d58c0d32166`

## Purpose

Define a platform-owned, tenant-extensible dynamic workflow runtime with:

- typed containment, authority, and configuration-inheritance graphs;
- a real Platform Admin Workspace containing Platform Brand;
- platform agents and workflows published as canonical assets or templates;
- tenant install, sparse override, extension, governed fork, and tenant-authored assets;
- immutable workflow versions and execution snapshots;
- replaceable runtime adapters for platform-native, n8n, Make, MCP, HTTP actions, and agent runtimes;
- idempotency, approvals, callbacks, retries, compensation, audit, and readback.

## Dependency chain

This spec extends, but does not assume merge of:

1. Spec Kit 004 — Shared Assets + Scope Inheritance, PR #1898, head `24ce7f5a29e30d9b091e73dcf9557f0a0add84a5`.
2. Spec Kit 005 — Dynamic Tool/Schema Surfaces + Activation Gateway, PR #1917, head `1f41bae8d95fb9e84cd188e0956b6891637b62be`.

## Core invariant

`Containment != Authority != Configuration Inheritance != Runtime Binding != Credential Ownership`.

Tenant containers are governed through explicit authority edges. They are not children of the Platform Admin Workspace.

## Scope

This Spec Kit is design-only. It does not apply migrations, enable providers, execute workflows, change credentials, or publish tenant-visible assets.
