# ADR-003: Unified Tenant GPT OAuth Client with Resource-Bound Access Tokens

**Status**: Accepted  
**Date**: 2026-07-22  
**Decision owner**: Platform Admin / Security / Activation Runtime  
**Supports**: Q-002 and the public multi-tenant Tenant GPT product model

## Context

The Tenant GPT is intended to be one public interface used by many users and tenants. Operating one OAuth client per tenant would multiply GPT Builder configuration, secret rotation, callback management, monitoring, support, and deployment complexity. It would not by itself provide tenant isolation, because tenant authority must still derive from verified user membership and tenant-scoped data access.

At the same time, a generic access token accepted across multiple platform resources would weaken protected-resource isolation and create confused-deputy risk.

## Decision

Use one registered OAuth application for the public Tenant GPT:

- `client_id = mad4b-tenant-gpt`;
- one centrally governed client secret/version set;
- one canonical authorization flow and callback allowlist;
- one public Tenant GPT experience for all users and tenants.

The shared OAuth client identifies the application, not the tenant. Each successful authorization produces a short-lived access token bound to:

- the authenticated user;
- exactly one selected/authorized tenant;
- the Activation protected resource;
- the granted scopes;
- the token purpose/profile;
- the registered OAuth client as authorized party.

The external token returned to ChatGPT uses the Activation resource contract:

```json
{
  "iss": "https://auth.mad4b.com",
  "aud": "https://activation.mad4b.com",
  "azp": "mad4b-tenant-gpt",
  "client_id": "mad4b-tenant-gpt",
  "resource": "https://activation.mad4b.com",
  "purpose": "tenant_gpt_access",
  "user_id": "verified-user",
  "tenant_id": "one-authorized-tenant",
  "scope": "tenant.status tenant.activation"
}
```

A generic internal platform user identity token may exist, but it is not sent directly to the Activation protected resource. The authorization server downscopes/mints the resource-specific access token returned to ChatGPT.

## Identity and authority boundaries

### OAuth client represents

- the public Tenant GPT application;
- the canonical OAuth configuration;
- the server-to-server token exchange client;
- shared monitoring, rotation, and callback governance.

### Access token represents

- one authenticated user;
- one authorized tenant context;
- one protected resource;
- explicit scopes and purpose;
- short-lived authorization state.

### Tenant isolation derives from

- verified token tenant/user claims;
- active membership readback;
- workspace and role/scope resolution;
- object-level authorization;
- tenant-scoped repository queries;
- operation ownership.

Tenant isolation does not derive from creating separate client IDs or secrets per tenant.

## Multi-tenant user selection

A user belonging to multiple tenants must select one tenant during authorization or through an explicit tenant-switch flow that results in a newly issued token. A single access token must not carry multiple tenant authorities or permit request-body tenant switching.

## Secret governance

- The client secret is stored only in approved credential authority.
- It is never embedded in GPT instructions, specification artifacts, source files, logs, or user-visible responses.
- Rotation is versioned and supports a short controlled overlap where the OAuth client platform requires it.
- Invalid-client attempts and secret-version use are monitored.
- Compromise response can revoke/rotate the shared client secret without changing tenant membership data.

## Consequences

### Positive

- One public GPT and one OAuth configuration serve all users and tenants.
- Adding a tenant requires membership/workspace provisioning, not GPT Builder changes.
- Secret rotation, callback governance, monitoring, and support are centralized.
- Resource-specific tokens preserve strong Activation isolation.
- User, tenant, resource, and scope remain explicit and testable.
- Additional protected resources can be introduced later with separately bound tokens.

### Costs and risks

- The shared client secret has broad application impact if compromised, so rotation and monitoring must be strong.
- Tenant isolation bugs in membership, repositories, or object authorization become critical and require comprehensive cross-tenant tests.
- Multi-tenant users require explicit selection and a new token when switching tenants.
- Internal generic identity tokens and external resource access tokens must remain clearly separated to avoid token confusion.

## Rejected alternatives

### One OAuth client per tenant

Rejected because it creates configuration and secret-management scale without replacing the need for tenant membership and object-level authorization.

### Generic platform access token sent directly to Activation

Rejected because resource isolation would depend on every service enforcing an auxiliary `resource` claim rather than a dedicated resource audience.

### Generic audience with scopes only

Rejected because scopes describe permitted actions but do not provide strong recipient/resource isolation.

## Relationship to ADR-002

ADR-002's phased cutoff applies to legacy generic tokens that are not bound to the Activation protected resource under the accepted token profile. It does not prohibit the internal platform from using a generic user-identity token for internal authorization-server workflows, provided that token is exchanged/downscoped and is never accepted directly by Activation.

## Implementation constraints

- Existing Tenant GPT client ID and secret configuration remain stable unless a separate rotation/migration is approved.
- New external access tokens use the Activation protected-resource audience.
- Token exchange binds client, callback, user, tenant, resource, scope, and purpose.
- Active membership is revalidated at protected operation entry.
- Caller-supplied tenant/user overrides are rejected or ignored in favor of the verified principal.
- Token switching between tenants requires a new token.
- No resource server may accept the internal generic identity token as an Activation access token.

## Verification

Required verification includes:

- the same client configuration successfully authorizes users from multiple tenants;
- each token contains exactly one tenant and the Activation resource;
- cross-tenant request/body/path overrides fail closed;
- a multi-tenant user receives a new token when switching tenant;
- an Activation token is rejected by unrelated protected resources;
- an internal generic identity token is rejected by Activation;
- client secret rotation works without exposing secret values;
- membership revocation immediately blocks protected operations even when the token has not expired.
