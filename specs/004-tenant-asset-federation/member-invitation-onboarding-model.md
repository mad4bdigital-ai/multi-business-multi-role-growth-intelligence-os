# Proposed Decision: Scoped Member Invitation and Google Onboarding

## Status

**Proposed for product approval.**

This decision defines how an invited person signs in with Google, joins an existing Tenant, receives exact Brand/Workspace/Department/Group/Role access, and optionally creates a separate personal workspace.

## 1. Core rule

Accepting a team invitation does **not** create a new Tenant automatically.

The platform uses a global user identity and multiple scoped memberships:

```text
Global User Identity
├─ optional Personal Account Tenant
│  └─ Personal Workspace
├─ Membership in Tenant A
│  └─ exact Brand/Workspace/Department/Group grants
└─ Membership in Tenant B
   └─ different exact grants
```

A new Tenant is created only when the user explicitly creates or activates a personal/business account, not as a side effect of accepting another Tenant's invitation.

## 2. Recommended user model

### Global user

One `users.user_id` represents the human across the platform.

External sign-in identities are linked separately:

- Google `sub`;
- verified Google email;
- platform password identity if present;
- future identity providers.

Recommended additive authority:

```text
user_identities
```

Key fields:

- identity ID;
- user ID;
- provider;
- provider subject;
- verified email;
- email verified flag;
- linked-at and last-used-at;
- status;
- assurance level;
- no OAuth token values.

Google `sub` becomes the stable provider identity after linking. Email is used to match the pending invitation during first acceptance.

## 3. Invitation scope

An invitation must carry an immutable, versioned scope snapshot rather than one broad role only.

Recommended structure:

```text
Invitation
├─ target Tenant
├─ invited normalized email
├─ base Tenant membership role
├─ Brand scopes
├─ Workspace scopes
├─ Department/Group assignments
├─ Role/profile assignments
├─ exact resource grants
├─ environment restrictions
├─ validity/expiry
└─ inviter authority/version
```

The base Tenant membership should normally be minimal, such as `member`. Actual access is produced by exact scoped grants.

Examples:

```text
Tenant member
+ Brand Dream Desert: operate
+ Workspace SEO Operations: edit
+ Department Marketing: member
+ Group SEO Team: member
+ Role SEO Specialist
```

or:

```text
Tenant member
+ Brand Acme: view
+ Workspace Finance Reporting: view
```

The invitation must not grant more authority than the inviter currently holds and is allowed to delegate.

## 4. Google invitation flow

```text
1. Owner/admin creates invitation with exact scope.
2. Platform stores token hash and immutable scope checksum.
3. Email outbox sends a single-use invitation link.
4. Invitee opens the link and sees a safe invitation preview.
5. Invitee chooses Continue with Google.
6. Platform verifies Google ID token, `email_verified`, audience, issuer, and nonce/state.
7. Verified email must match the invited email.
8. Existing global user is reused, or a new user identity is created without creating a Tenant.
9. Invitee explicitly accepts or declines.
10. One transaction creates/reactivates Tenant membership and exact scoped grants/assignments.
11. Invitation becomes accepted and single-use.
12. Platform issues or refreshes a target-context session.
13. User lands in the exact Brand/Workspace context from the invitation.
14. Personal workspace creation is offered separately according to policy.
```

## 5. Existing versus new users

### Existing platform user

- reuse the same global user;
- add or reactivate the target Tenant membership;
- add only missing approved scopes;
- preserve existing personal and other Tenant memberships;
- do not create another Tenant;
- do not silently downgrade or replace wider existing authority.

### New Google user

- create `users` row and Google `user_identities` row;
- do not create a Tenant before invitation acceptance;
- accept the target Tenant membership and grants transactionally;
- optionally offer personal workspace after successful join.

### User already belongs to target Tenant

Acceptance is idempotent:

- mark invitation accepted;
- add only explicitly invited missing grants;
- do not duplicate membership;
- do not overwrite a higher role with a lower one;
- require explicit review before replacing conflicting assignments.

## 6. Personal workspace decision

A personal workspace is separate from the invited company Tenant.

Recommended model:

```text
Tenant type: personal_account
Workspace type: personal
Owner: one global user
Creation: explicit or lazy
Maximum default: one personal account per user
```

Recommended behavior:

- invitation acceptance never auto-creates it;
- standalone signup may prompt to create it;
- after joining a team, the UI may offer `Create personal workspace`;
- existing personal workspace remains available;
- personal resources are invisible to invited Tenants and their administrators;
- company resources cannot be copied into personal space without explicit export/copy policy;
- credentials and connections remain owner/scope governed.

Suggested settings:

```yaml
personal_workspace:
  policy: optional
  create_on_invitation_accept: false
  prompt_after_invitation_accept: true
  create_on_standalone_signup: prompt
  maximum_per_user: 1
  tenant_type: personal_account
  workspace_type: personal
```

Platform policy may disable personal workspaces for selected plans or jurisdictions.

## 7. Context selection

A multi-membership user must not be permanently bound to the first Tenant membership.

Recommended session model:

1. identity session proves the user;
2. active context selects Tenant, Brand, Workspace, Department, and optional Group/Role;
3. a short-lived context token or server-side session is issued after membership/grant validation;
4. context switching revalidates authority and creates a new context version;
5. the UI exposes a context switcher:

```text
Personal Workspace
Dream Desert / SEO Operations
Client B / Reporting
Agency C / Campaign Workspace
```

No cross-context data is shown in one view unless a separately governed aggregate view exists.

## 8. Current-state gaps confirmed

Current live implementation has:

- `invitations` with Tenant, email, one role, token, status, metadata, and expiry;
- `memberships` at Tenant level;
- `workspace_resource_grants` with Workspace/Brand/Site/App/Asset/Workflow/Agent/Vault resource types;
- Google sign-in and invitation acceptance;
- exact invitation-email match against the signed-in user;
- invitation acceptance that creates/reactivates Tenant membership.

Current gaps:

- invitation scope is not a typed immutable resource set;
- acceptance currently creates a broad default workspace grant derived from Tenant membership;
- Department/Group/Role/Brand/Workspace assignments are not atomically modeled in the invitation;
- invitation creation returns the raw token and does not use a dedicated invitation email outbox flow;
- token storage should be hash-only for production;
- personal Tenant/Workspace types are not explicit;
- multi-Tenant login currently risks choosing the first membership as active context;
- there is no first-class identity-only session plus context-switch contract.

## 9. Proposed authorities

```text
user_identities
invitation_scope_bindings
invitation_delivery_events
invitation_acceptance_runs
personal_account_profiles
active_user_contexts
context_switch_events
```

`invitation_scope_bindings` may target:

- Tenant membership;
- Brand;
- Workspace;
- Department;
- Group;
- Role/profile;
- Workflow;
- Agent;
- Asset/capability;
- future registered resource types.

Each binding stores permission/effect, conditions, expiry, source authority, and checksum.

## 10. Security invariants

- invitation token is single-use, expiring, revocable, and stored as a hash;
- raw token is sent only through the approved delivery channel and is never logged;
- Google email must be verified and match the invitation exactly after safe normalization;
- Google hosted-domain metadata is not authorization;
- the invitee may switch Google account when the email does not match;
- inviter cannot delegate authority it does not hold;
- scope snapshot cannot expand after delivery without a new invitation/revision and disclosure;
- acceptance is transactional and idempotent;
- Tenant membership is required before Tenant resources become accessible;
- personal workspace is isolated from every team Tenant;
- invitation never transfers credentials or connection ownership;
- expired/revoked invitations fail closed;
- accepting one invitation does not change memberships in other Tenants;
- context switching requires current membership and grant validation.

## 11. Proposed lifecycle

```text
draft
→ pending_delivery
→ delivered
→ viewed
→ authenticated
→ accepted | declined | expired | revoked
```

Acceptance persists:

- user identity source/version;
- invitation scope checksum;
- granted membership and resource IDs;
- inviter and accepter;
- acceptance timestamp;
- context issued;
- readback checksum;
- no-secret audit evidence.

## 12. API direction

Resource-oriented planned surfaces:

```text
POST /tenant/invitations
GET  /tenant/invitations/{invitationId}
POST /tenant/invitations/{invitationId}/deliveries
POST /tenant/invitations/{invitationId}/revoke
GET  /invitations/{token}/preview
POST /invitations/{token}/accept
POST /invitations/{token}/decline

GET  /me/memberships
GET  /me/contexts
POST /me/active-context

POST /me/personal-account
GET  /me/personal-account
POST /me/personal-workspaces
```

The public preview returns only safe Tenant/Brand/Workspace names and scope summaries. Mutations use idempotency, version preconditions, stable error envelopes, audit, and readback.

## 13. Recommended decision

Adopt:

> **Identity-first, scope-aware invitation onboarding.** Google Sign-In creates or links one global user identity. Accepting an invitation joins the existing target Tenant and creates exact Brand/Workspace/Department/Group/Role grants from an immutable invitation scope. It does not create a new Tenant. A separate personal-account Tenant and personal Workspace may be created lazily and explicitly, allowing the same user to own a private workspace while participating in multiple company Tenants.

Recommended defaults:

```text
Invitation creates new Tenant: no
Invitation creates global user when needed: yes
Base Tenant membership: minimal member
Access grants: exact invitation scopes
Broad default workspace grant: disabled for scoped invitations
Google verified-email match: mandatory
Invitation email delivery: outbox-based
Invitation token storage: hash only
Personal workspace: optional and lazy
Personal workspace after invite: prompt, not auto-create
One personal account per user: yes by default
Multi-Tenant context switcher: required
Active context selected from first membership: forbidden
```