# Phase 2 Intent-First Resolver and Admin/Tenant Isolation

## Scope

This slice completes T123 and T124 without replacing the canonical execution-contract resolver.

The resolver continues to obtain final authority from the existing action, endpoint, capability, certification, resource-operation, and readback registries. A new additive `execution_intent_contract_bindings` registry maps a stable semantic `intent_key` to the exact action, endpoint, capability, and optional runtime surface required by the existing resolver.

## Intent-first contract

A caller may provide:

- `intent_key`;
- `requested_mode`;
- `principal_scope`;
- tenant/workspace/resource context when applicable;
- optional explicit action, endpoint, capability, or runtime-surface keys for conflict detection only.

When `intent_key` is present, the resolver:

1. Reads only safe binding columns from `execution_intent_contract_bindings`.
2. Filters inactive, future, and expired bindings.
3. Requires an exact principal-scope binding.
4. Rejects equally authoritative bindings.
5. Rejects explicit keys that conflict with the registry binding.
6. Passes the resulting exact action/endpoint/capability tuple through the existing canonical resolver.

Legacy exact-key input remains supported.

## Isolation rules

- `principal_scope=tenant` requires `tenant_ref` before any database query.
- Tenant callers cannot resolve admin or internal intent bindings.
- Tenant callers cannot use actions or endpoints marked `admin_only`.
- Resource-operation candidates must match the principal scope or an explicitly shared/global scope.
- Admin, tenant, and internal bindings are separate authority records; no scope is inferred from route names or identifiers.
- Ambiguity is fail-closed rather than resolved by first-row selection.

## No-secret boundary

The intent registry query excludes credentials, authorization headers, schemas, and provider payloads. Resolver output contains only bounded registry identifiers, revision metadata, policy projections, hashes, and boolean guarantees. Raw evidence and secret-bearing database columns are not returned.

## Migration boundary

`20260730_spec011_execution_intent_contract_bindings.sql` is an additive contract only.

This slice does not:

- apply the migration to Production;
- seed customer-specific or tenant-specific identifiers;
- write Production data;
- add provider calls;
- add or widen a public route;
- deploy or certify Production runtime parity.

Production use requires governed migration authorization, registry population through governed tooling, and same-cycle schema/readback evidence.
