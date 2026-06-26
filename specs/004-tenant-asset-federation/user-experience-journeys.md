# User Experience Journeys

## 1. Experience principles

- Start from shared assets, not setup duplication.
- Show the difference between available, authorized, configured, and executable.
- Let users personalize without forcing them to understand policy internals.
- Offer advanced composition controls progressively.
- Explain every block with a concrete recovery path.
- Show no more than three prioritized next actions.
- Preview impact before changing profiles or variants.
- Make reset-to-shared obvious and safe.
- Preserve user trust through visible adaptation controls.

## 2. Catalog mental model

Every asset card presents four independent states:

### Availability

- shared and visible;
- entitled;
- restricted to another plan/scope;
- platform internal.

### Authority

- usable by this user/context;
- visible but not granted;
- role or policy restricted;
- approval-sensitive.

### Configuration

- no setup required;
- tenant/user connection required;
- credentials validating;
- optional customization available;
- personal/scoped variant active.

### Operational readiness

- ready for read;
- ready with approval;
- installation pending;
- certification expired;
- quota/budget blocked;
- provider unavailable;
- variant conflict.

The UI must not collapse these into one generic active/inactive badge.

## 3. Journey A — Use a shared workflow immediately

### Starting context

A user opens the shared catalog in an authorized workspace.

### Flow

1. Search for `SEO Audit`.
2. Asset card shows `Shared`, `Authorized`, `No credentials required`, `Ready`.
3. User opens `Why available?` and sees tenant/workspace/role sources.
4. User selects Run.
5. The platform previews the effective runtime manifest.
6. User confirms only if policy requires confirmation.
7. Execution links to the manifest and result evidence.

### Data effect

No tenant workflow copy or variant is created.

## 4. Journey B — Use a shared plugin with tenant credentials

1. User opens the WordPress plugin card.
2. Card shows shared features and tenant-specific readiness.
3. Status: `Connection required`.
4. User chooses `Connect my account` or an administrator chooses a tenant/workspace connection.
5. Governed OAuth/credential intake collects the secret outside the asset surface.
6. Validation creates or updates connection/install evidence.
7. Asset card becomes `Ready for read`; write actions remain `Approval required` if applicable.
8. User selects a shared workflow or action; no plugin copy is created.

The catalog never displays or stores the credential value.

## 5. Journey C — Personalize behavior without a variant

1. User opens `My working preferences`.
2. Chooses Arabic responses, detailed explanations, concise executive summaries, and Analytics Agent as first choice for reports.
3. Platform previews affected surfaces.
4. User saves.
5. Future resolution ranks authorized options according to preferences.

A preference is created; no asset variant is needed.

## 6. Journey D — Select a composition profile

1. User opens `How layers combine` for workflows.
2. Platform presents templates:
   - Explore;
   - Focused;
   - Brand strict;
   - Role strict;
   - Automation safe;
   - Regulated.
3. Each template shows:
   - included layers;
   - whether it broadens discovery or tightens execution;
   - examples of changed results;
   - non-overridable safety floor.
4. User compares current and proposed impact.
5. User applies the profile to their own context or requests scoped publication if they administer a wider scope.
6. Change history records the selection.

The user does not directly edit grants.

## 7. Journey E — Create a personal variant

1. User opens shared `Monthly Growth Report` workflow.
2. Chooses `Customize my version`.
3. Platform offers allowed fields only:
   - section ordering;
   - output format;
   - optional prompt fragment;
   - presentation depth.
4. User edits and previews a diff against shared version 7.
5. Platform validates modifiable paths and risk.
6. User publishes a personal variant.
7. Card shows `Shared base + my variant`.
8. `Reset to shared` remains available.

If the shared base upgrades, the platform shows upgrade status and conflicts.

## 8. Journey F — Brand administrator publishes a brand profile

1. Administrator resolves Brand Core.
2. Opens brand governance.
3. Creates a profile requiring brand and activity layers for publishing.
4. Preview lists affected users, roles, workflows, and actions.
5. The profile may tighten but cannot silently loosen inherited mandatory policy.
6. Publication requires version confirmation and any configured approval.
7. Affected manifests invalidate through epoch/version change.
8. Users see the new rule and explanation on next preview.

## 9. Journey G — Blocked action and recovery

A user attempts WordPress publish.

Runtime result:

```text
Authorized by workspace and role
Blocked: no active installation
Approval-sensitive grant present
No open approval request yet
```

The interface shows three actions only:

1. Complete WordPress connection validation.
2. Request exact publish approval.
3. Run content validation preview without publishing.

It does not show `permission denied` when the real problem is installation readiness.

## 10. Journey H — Adaptive recommendation

1. Platform observes that the user repeatedly chooses the same authorized workflow and obtains better verified outcomes.
2. A proposal appears:
   `Use Conversion Funnel Analysis as your first recommendation for ecommerce growth.`
3. Explanation shows:
   - evidence window;
   - number of successful uses;
   - expected benefit;
   - confidence;
   - no authority change;
   - reset/expiry behavior.
4. User accepts, edits, or dismisses.
5. Acceptance changes ranking only.

No hidden preference is applied before the configured consent policy.

## 11. Journey I — Composition experiment

1. User receives a proposal to use `Focused` instead of `Explore` for analytics workflows.
2. Impact preview compares candidate counts, expected relevance, missed options, and historical task success.
3. User starts a 14-day personal experiment.
4. UI shows active treatment, baseline, progress, and stop button.
5. The experiment promotes only if success/guardrails pass and the user accepts finalization where required.
6. Otherwise it expires or rolls back.

## 12. Journey J — Tenant improvement becomes platform candidate

1. A tenant-specific variant performs well over a sufficient period.
2. Tenant admin may nominate it for reuse or the platform may suggest nomination.
3. A promotion preview identifies tenant-specific content and removes/flags it.
4. Tenant content is not exported automatically.
5. Platform reviewers create a separate sanitized candidate.
6. Candidate follows tests, certification, PR/release, and new shared version publication.
7. The originating tenant may keep its variant or reset to the new shared base.

## 13. Journey K — Explain my effective behavior

User asks: `Why did the platform choose this workflow and require approval?`

The explanation includes:

- resolved tenant/workspace/brand/activity/role;
- selected composition profile;
- shared workflow version;
- active variant and preference, if any;
- policy fields and operators;
- connection and certification readiness;
- approval-sensitive grant versus open hold;
- exact blocking or selection reasons;
- observation timestamp.

It never reveals hidden prompts, another user's private preference, or credential material.

## 14. Journey L — Choose and customize billing behavior

### Starting context

A user or delegated commercial administrator opens `Billing preferences` for an eligible billing account or Workspace context.

### Flow

1. Platform loads the effective billing-profile template from the database and shows only eligible options.
2. User compares available models, for example:
   - Credits;
   - Direct currency with prepaid balance;
   - Direct currency with postpaid invoice, only when the contract permits it.
3. Each option explains:
   - settlement asset;
   - included quantities and meter bundle;
   - expected price/rating source;
   - reservation behavior;
   - overage and hard-stop behavior;
   - statement/invoice implications;
   - fields the user may customize.
4. User may select eligible options and customize only allowed fields such as:
   - presentation currency;
   - budget alerts and notification cadence;
   - cost-center or attribution labels;
   - statement grouping and usage detail;
   - a lower reservation ceiling;
   - an eligible included-meter bundle.
5. Platform previews the exact effective profile, conflicts, expected reservation asset, sample cost for representative meters, commercial-epoch impact, and no more than three recovery actions.
6. Preview performs no reservation, charge, invoice, payment, provider call, credential read, or external write.
7. Publication validates template/version, field allowlist, contract, plan, Tenant policy, delegated limits, standing, and approvals.
8. Affected estimates and manifests invalidate after the new profile version becomes active.
9. User can inspect history and return to an eligible parent/default profile through a governed selection change.

### Meter experience

The user sees business-relevant meters rather than a token-only view. Depending on the service, usage may be displayed as documents processed, audio/video seconds, storage over time, compute, Agent runs, API calls, seats, messages, leads enriched, reports generated, or verified outcomes.

Advanced detail may disclose technical component meters such as input/output tokens, vector queries, GPU time, or storage bytes when policy permits, but customer billing remains tied to the registered billable meter and price version.

### Forbidden experience

The UI never offers free-form editing of price, tax, FX rate, unit conversion, ledger account, credit limit, billable owner, payment credential, or arbitrary formulas. A disabled option explains the governing contract or policy rather than pretending it is unavailable globally.

## 15. Journey M — Choose contextual model behavior

### Starting context

A user or delegated administrator opens `Model preferences` for an eligible Tenant, Workspace, activity, Agent, or task context.

### Flow

1. Platform resolves the registered task class, capability contract, data-use policy, region, risk, entitlement, and billing context.
2. UI shows eligible optimization profiles such as:
   - quality first;
   - balanced;
   - cost first;
   - latency first;
   - privacy first;
   - local only;
   - reliability first.
3. Each profile explains mandatory floors, metrics/weights, expected quality/latency/cost trade-offs, data/region behavior, and fallback policy.
4. When permitted, the user may:
   - select an eligible optimization profile;
   - prefer an eligible provider/model;
   - request privacy-first or local-only behavior;
   - set lower personal maximum cost or latency;
   - disable fallback;
   - pin an eligible exact model version for a low-risk task.
5. The user cannot enter a raw model ID, provider endpoint, credential, arbitrary ranking formula, or lower a mandatory quality/safety/data/region/tool/output/evaluation/readiness floor.
6. Preview displays:
   - exact eligible candidates and versions;
   - candidates excluded by each hard gate;
   - evaluation/scorecard/readiness freshness and confidence;
   - optimization metrics, weights, rank, and deterministic tie-break evidence;
   - selected candidate and independently eligible fallback set;
   - provisional customer charge, provider/internal cost, and reservation requirement;
   - model-governance epoch, expiry, and recovery actions.
7. Preview performs no provider/model call, credential read, evaluation execution, commercial reservation, lifecycle mutation, or external write.
8. Publishing a preference creates a new immutable preference revision and invalidates affected previews/manifests when required.
9. Before provider dispatch, runtime revalidates exact model/version, data/region policy, scorecard, readiness, lifecycle/incident state, reservation, fallback, and governance epoch.
10. If the selected candidate becomes unavailable before output begins, runtime uses only a manifest-bound eligible fallback or blocks.
11. If output or tool effects already began, UI reports that automatic model switching is unsafe and follows DFR-006 restart/resume/compensation policy.

### Explanation experience

The default explanation is concise:

```text
Selected: Candidate A
Why: passed all mandatory gates; highest balanced score
Fallback: Candidate B, before-output only
Cost authorization: reserved
Evidence freshness: current
```

Advanced detail exposes safe metric/evidence references without credentials, private prompts, hidden provider contract terms, another Tenant's preferences, or unrestricted evaluation content.

### Incident and deprecation experience

When a model is restricted, revoked, or deprecated, affected users see:

- the exact impacted task/context;
- whether new use is blocked;
- eligible replacements;
- migration deadline;
- fallback availability;
- cost/quality/latency differences;
- rollback or exception status where permitted.

Emergency revocation blocks new dispatch immediately and preserves historical run evidence.

## 16. Progressive disclosure

### Basic users see

- Shared assets;
- Ready / setup required / blocked;
- preferred choices;
- simple profile templates;
- customize/reset;
- top recovery actions.

### Advanced users see

- layer-by-layer explanation;
- field operators;
- profile rules;
- variant diff and upgrade state;
- experiment metrics;
- revisions and audit.

### Administrators see

- coverage and parity;
- scope publication;
- grants and delegations;
- connection/install/certification;
- approval holds;
- cross-scope impact;
- rollout and rollback controls.

## 16. Notification design

Notifications are event- and preference-aware:

- action required: credential expired, approval requested, variant conflict;
- outcome: execution completed, experiment measured;
- recommendation: at most configured cadence and relevance threshold;
- governance: profile/policy change affecting the user;
- safety: blocked or rolled-back experiment.

Recommendations cannot use urgency language unless an actual deadline or risk exists.

## 17. Accessibility and localization

- all statuses use text plus icon, not color only;
- explanations support RTL and localized dates/numbers;
- policy terms have plain-language labels and advanced definitions;
- keyboard navigation and screen-reader names are required;
- diff and graph views have accessible table alternatives;
- user language preference never changes canonical IDs or policy evaluation.

## 18. Empty, loading, and degraded states

The UI distinguishes:

- no matching shared assets;
- not yet entitled;
- catalog unavailable;
- authority evidence incomplete;
- readiness evidence stale;
- resolver validating;
- zero results after filters;
- no recommendations because confidence is insufficient.

It never converts unavailable evidence into a false zero.

## 19. Product success criteria

- user reaches first shared ready asset without variant creation;
- setup blockers are correctly classified;
- profile impact preview predicts certified cases;
- users can reset preferences/variants without support;
- explanations reduce repeated permission/setup confusion;
- recommendation acceptance is measured with result observation, not clicks alone;
- personalization opt-out and history are discoverable;
- eligible users can compare Credits and monetary options and understand reservation, included usage, and statement impact before selection;
- billing customization exposes only registered allowed fields and explains disabled options through contract/policy evidence;
- usage is presented through service-relevant meters beyond tokens while technical components remain explainable when permitted;
- billing-profile preview predicts certified cases and causes no reservation, charge, invoice, payment, provider call, or external write;
- advanced controls do not obstruct the default shared-asset journey.
