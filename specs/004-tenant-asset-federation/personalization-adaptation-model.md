# Personalization and Optional Adaptation Model

## 1. Personalization is not authorization

Each user may customize how the platform behaves for them, but personalization is evaluated only after authority has produced an allowed candidate set.

The platform separates:

1. **Authority:** what the principal may access or execute.
2. **Composition:** how applicable context layers combine.
3. **Preference:** what the user prefers among authorized results.
4. **Variant:** an explicit customized form of a shared asset.
5. **Adaptation:** a proposed change derived from evidence.

## 2. User experience profile

A generic user profile may include:

- preferred language and locale;
- communication tone;
- explanation depth;
- compact or detailed response preference;
- preferred agents and workflows;
- preferred provider among equally ready alternatives;
- notification channels and cadence;
- working hours and quiet hours;
- dashboard layout preferences;
- default composition profile per dimension;
- autonomy preference within platform limits;
- review preference for medium-risk actions;
- preferred output formats;
- accessibility settings;
- learning/adaptation consent and visibility settings.

It contains no credentials, secrets, hidden system prompts, or cross-tenant information.

## 3. Optional variants

### Creation

A variant is created only when the user explicitly chooses to customize a shared asset or accepts an adaptation proposal that requires an asset-level change.

### Ownership scopes

- user;
- role;
- workspace;
- brand;
- business activity;
- tenant.

### Patch types

- append;
- override of allowed fields;
- remove or disable allowed optional elements;
- reorder;
- prompt fragment customization;
- policy tightening;
- tool binding preference;
- output template customization.

### Forbidden variant changes

- raw credentials or tokens;
- tenant identity or resource-authority overrides;
- mandatory platform policy removal;
- destructive-operation enablement;
- hidden provider URL or authorization injection;
- cross-tenant references;
- unregistered executable code;
- disabling audit, approval, readback, or certification.

## 4. Variant resolution

Variants are applied after authority and base candidate selection but before final non-authority preference ranking.

When multiple variants apply:

1. only variants visible to the principal and context participate;
2. owner scope specificity and registered priority determine order;
3. patches are validated against the asset schema and modifiable-path registry;
4. equal-ranked conflicting patches block;
5. a mandatory-field modification is rejected;
6. result checksum and provenance are written to the effective manifest.

## 5. Personal variants and shared updates

A variant stores a base asset version and checksum. When the shared base changes:

- unchanged paths rebase automatically in preview;
- changed but non-conflicting paths produce an upgrade proposal;
- conflicting paths require explicit review;
- an archived or security-revoked base may block continued use;
- the user may reset to the new shared default.

## 6. Adaptation sources

The platform may derive suggestions from:

- explicit user feedback;
- accepted and dismissed recommendations;
- repeated manual choices;
- intent-to-workflow success;
- task completion and verification;
- business outcomes;
- error and retry patterns;
- time spent and friction;
- comparison of composition profiles;
- variant experiment results.

Inferred preferences must carry confidence, source categories, freshness, and an explanation.

## 7. Adaptation classes

### Class A — presentation only

Examples: explanation depth, dashboard ordering, language preference. May be applied after user opt-in or explicit confirmation, with immediate rollback.

### Class B — workflow preference

Examples: preferred authorized agent or workflow. Requires preview and user acceptance; cannot change authority.

### Class C — scoped composition

Examples: change from explore to role-strict for a policy family. Requires impact simulation and explicit confirmation.

### Class D — asset variant

Examples: customized prompt fragment or output template. Requires schema validation, diff, and versioned acceptance.

### Class E — authority or consequential execution

Examples: grants, provider writes, spend, credentials, deployment, destructive actions. Personalization cannot apply these. They follow the existing governed authority and approval chain.

## 8. Transparency and controls

Users can:

- inspect why a preference was inferred;
- accept, edit, dismiss, or expire a proposal;
- disable adaptation categories;
- reset a profile or variant;
- view active experiments;
- compare effective behavior before and after;
- export or remove their preference data subject to retention policy.

## 9. Privacy and cross-tenant learning

Tenant-specific content and user-level behavior remain scoped. Platform-wide learning may use only approved aggregated signals or manually promoted reusable patterns. Promotion candidates must remove tenant identifiers, confidential content, credential references, and proprietary instructions before review.
