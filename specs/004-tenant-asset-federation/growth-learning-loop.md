# Governed Growth and Learning Loop

## 1. Objective

The platform should become more useful as it is used, while remaining deterministic, auditable, tenant-isolated, and reversible. Learning improves recommendations, composition defaults, shared asset quality, and user experience; it does not silently expand authority.

## 2. Signal model

### Existing evidence sources

- `tenant_growth_recommendation_events`
- `intent_resolutions`
- `execution_log`
- `workflow_runs` and `step_runs`
- `output_artifacts`
- readiness checks and operational alerts
- user feedback and dashboard preferences
- adaptation and variant edit records
- business KPI/result observations

### Signal categories

- explicit preference;
- behavioral preference;
- execution quality;
- operational friction;
- business outcome;
- risk/safety event;
- readiness gap;
- cost and quota efficiency;
- novelty or repeated unmet intent.

Signals are not authority. They are evidence for proposals.

## 3. Outcome model

Each optimization declares an objective and guardrails.

Example objectives:

- increase successful workflow completion;
- reduce time to first useful result;
- improve recommendation acceptance;
- improve verified SEO or conversion KPI;
- reduce failed provider calls;
- reduce manual retries;
- improve user satisfaction;
- reduce cost per successful outcome.

Guardrails include:

- no increase in policy violations;
- no increase in unauthorized attempts;
- no secret exposure;
- no unacceptable latency or cost regression;
- no decrease in verification quality;
- no cross-tenant leakage.

## 4. Lifecycle

### 4.1 Observe

Collect bounded, purpose-specific, no-secret events with tenant/user/context scope and freshness.

### 4.2 Attribute

Relate outcomes to the effective runtime manifest: selected shared assets, variants, composition profile, context paths, connection readiness, and execution version.

### 4.3 Diagnose

Identify friction or opportunity and separate correlation from evidence strong enough for a proposal.

### 4.4 Propose

Create a typed adaptive proposal containing:

- target scope;
- current and proposed state;
- objective and expected impact;
- evidence references;
- confidence and uncertainty;
- risk class;
- required approval;
- simulation plan;
- measurement window;
- rollback plan;
- expiry.

### 4.5 Simulate

Replay the proposal against a bounded historical or synthetic corpus. Compare authority, readiness, chosen assets, predicted outcomes, policy violations, cost, and latency. Simulation performs no provider write.

### 4.6 Approve

Apply the decision policy by adaptation class. User preferences can require user confirmation; tenant or authority changes require the proper role and approval hold.

### 4.7 Canary

Apply the proposal to an exact user, role, workspace, brand, or activity cohort for a bounded period. Canary scope is immutable and hashed.

### 4.8 Measure

Compare outcome and guardrail metrics to baseline. Correct for insufficient sample size and stale context.

### 4.9 Promote or roll back

- promote to a stable preference/profile/variant when criteria pass;
- extend measurement when evidence is insufficient;
- roll back automatically on safety or quality regression;
- expire proposals that no longer match the authority epoch or base asset version.

## 5. Dynamic platform growth

The platform grows in three directions:

### User growth

Learns presentation, workflow, and composition preferences for one user.

### Tenant growth

Identifies reusable tenant-specific profiles, brand practices, activity workflows, and integration readiness improvements.

### Platform growth

Creates promotion candidates for new shared assets, improved defaults, or policy templates based on certified, privacy-safe evidence. Platform promotion is a separate governed release, not an automatic tenant-to-platform copy.

## 6. Recommendation ranking

Next-best actions are ranked using:

- expected business impact;
- readiness and probability of successful execution;
- user goal relevance;
- effort and time-to-value;
- risk and approval burden;
- freshness and evidence confidence;
- diversity to avoid repetitive recommendations;
- user dismissal and acceptance history.

The customer surface should show no more than three prioritized actions at once.

## 7. Novelty discovery

Repeated unmatched or ambiguous intents may generate a capability-gap proposal. A gap proposal can recommend:

- a new shared workflow;
- a new tool or connector;
- a new business activity profile;
- a new composition template;
- a variant or prompt improvement;
- a documentation or onboarding improvement.

A gap never creates executable code or provider authority automatically.

## 8. Metrics

### Product

- time to first value;
- activation completion;
- active users and retained workspaces;
- recommendation acceptance and result-observed rate;
- preference and variant adoption;
- successful reset/rollback rate.

### Execution

- ready-to-dispatch ratio;
- success and verification rate;
- approval turnaround;
- provider failure and retry rate;
- p50/p95/p99 resolution latency;
- stale or ambiguous context rate.

### Business

- objective-specific KPI uplift;
- revenue/conversion/lead/traffic/retention impact where configured;
- cost per verified outcome;
- realized versus predicted impact.

### Safety

- unauthorized execution attempts;
- policy conflict count;
- secret-field rejection count;
- cross-tenant access violations;
- canary rollback triggers;
- unresolved adaptation debt.

## 9. Anti-optimization controls

The platform must not optimize a proxy metric at the expense of user or business outcomes. Every experiment includes guardrails, minimum evidence, expiry, and human-visible explanation. Dark patterns, notification spam, approval avoidance, and risk under-reporting are forbidden optimization strategies.
