# Adaptive Scoring and Confidence Model

## 1. Purpose

Adaptive recommendations must rank useful changes without confusing popularity, convenience, or clicks with verified business value. The scoring model is therefore multi-objective, uncertainty-aware, scope-bounded, and constrained by safety/readiness.

The score is advisory. It cannot grant authority or approve consequential execution.

## 2. Candidate types

- preferred shared asset;
- composition profile selection;
- user preference adjustment;
- optional variant;
- connection/readiness remediation;
- workflow or capability gap;
- tenant-local reusable pattern;
- platform promotion candidate.

Each type has its own eligibility, evidence, and approval policy.

## 3. Eligibility gate

A candidate is not scored for action unless:

- tenant and subject scope are valid;
- target asset/profile exists and is active;
- evidence is fresh enough for the candidate class;
- required minimum observations exist;
- no mandatory policy or privacy block applies;
- change class and approval route are known;
- simulation is available where required;
- rollback/reset behavior is defined.

Ineligible candidates may appear only as diagnostics with a typed gap reason.

## 4. Core score

A normalized conceptual score:

```text
adaptive_score =
  expected_impact
× probability_of_success
× relevance
× readiness
× evidence_quality
× trust_factor
× novelty_factor
− effort_penalty
− risk_penalty
− approval_friction
− cost_penalty
− uncertainty_penalty
```

The implementation should keep component values separate and explainable rather than storing only one opaque score.

## 5. Components

### Expected impact

Predicted improvement against a declared objective:

- workflow completion;
- time to value;
- verified quality;
- SEO/conversion/revenue/lead outcome;
- cost reduction;
- operational reliability;
- user satisfaction.

Impact is objective-specific and must include unit, baseline, horizon, and confidence interval.

### Probability of success

Estimated likelihood that the proposed change produces the intended result in the target context. It is reduced by context mismatch, stale evidence, incomplete readiness, and contradictory results.

### Relevance

Similarity between evidence and target context:

- same user;
- same role;
- same workspace;
- same brand;
- same business activity;
- same workflow/action;
- same provider/runtime conditions;
- similar objective and constraints.

Personal evidence outranks broad aggregate evidence when enough observations exist.

### Readiness

A multiplicative readiness factor based on:

- authority completeness;
- connection/install/certification;
- available quota/budget;
- approval path;
- provider health;
- variant/base compatibility.

A blocked consequential action receives readiness zero for execution ranking, though it may rank as a remediation recommendation.

### Evidence quality

Combines:

- sample size;
- verification strength;
- freshness;
- measurement completeness;
- attribution quality;
- source diversity;
- missing-data rate;
- consistency across windows.

Clicks and opens have lower evidence weight than completed, verified, result-observed outcomes.

### Trust factor

Accounts for:

- explicit user acceptance/dismissal;
- preference stability;
- transparency shown;
- prior recommendation calibration;
- opt-in/opt-out state;
- notification fatigue.

Repeated dismissal reduces similar recommendations without hiding urgent safety items.

### Novelty factor

Prevents permanent dominance by the same assets while respecting user preference. Novelty is bounded and cannot elevate unauthorized or lower-quality options above safety thresholds.

### Penalties

- effort: setup steps, credentials, approvals, migration burden;
- risk: operation class, data sensitivity, reversibility;
- approval friction: approver count and historical turnaround;
- cost: expected platform/provider spend;
- uncertainty: wide confidence interval, sparse or conflicting evidence.

## 6. Confidence model

Confidence is reported separately from score:

```text
very_low | low | moderate | high | very_high
```

It is derived from evidence volume, quality, consistency, freshness, and context similarity.

Rules:

- a high predicted impact with low confidence stays an experiment candidate, not a default;
- a low-risk presentation preference may be proposed at moderate confidence;
- a composition or variant proposal requires higher confidence and simulation;
- platform promotion requires very high evidence quality plus human certification;
- confidence must decay as evidence ages or context changes.

## 7. Bayesian-style updating without opaque automation

The system may update prior beliefs with observed outcomes, but must persist:

- prior source and version;
- evidence window;
- likelihood/weight contribution;
- posterior estimate;
- uncertainty interval;
- model/calculation version.

No hidden external model output becomes authoritative without bounded interpretation and explanation.

## 8. Calibration

Calibration compares predicted probability/impact with realized results.

Required views:

- predicted success bucket versus actual success rate;
- predicted impact versus realized impact;
- recommendation acceptance versus verified outcome;
- confidence class versus error rate;
- rollback rate by proposal class;
- false-positive and false-negative examples.

Poor calibration lowers trust factor and blocks automatic promotion.

## 9. Minimum evidence by class

Illustrative defaults subject to governance:

| Class | Minimum evidence | Simulation | Confirmation |
|---|---|---|---|
| A presentation | explicit preference or repeated pattern | optional | user/opt-in policy |
| B workflow preference | repeated successful selections and verified outcomes | recommended | user |
| C composition profile | sufficient comparable manifests/outcomes | required | user/admin by scope |
| D asset variant | task corpus plus schema/certification evidence | required | publisher/approver |
| E authority/consequential | evidence does not replace authority | required where useful | governed approval only |
| Platform promotion | privacy-safe multi-window evidence and certification | required | platform release governance |

## 10. Ranking constraints

- blocked candidates cannot rank as executable;
- at most one high-friction recommendation appears among the top three unless urgent;
- recommendations diversify objective and action type;
- repeated dismissal applies a cool-down;
- safety/remediation may outrank growth when required for reliable execution;
- user-declared goal weights are respected within policy;
- score ties use stable deterministic keys, never random row order.

## 11. Business value attribution

Where business KPIs are configured, attribution records:

- objective and baseline;
- target metric and unit;
- attribution window;
- effective manifest IDs;
- treatment and control/cohort;
- confounders and data completeness;
- realized value and confidence;
- cost and effort;
- net value estimate.

The platform must not claim causality when only correlation is supported.

## 12. Failure and abuse controls

- prevent click optimization without result evidence;
- reject manipulated or duplicate events;
- down-weight self-reported outcomes without verification where applicable;
- detect recommendation spam and feedback loops;
- prevent one tenant's volume from dominating platform promotion;
- do not infer sensitive personal attributes;
- do not use hidden pricing or plan pressure as relevance;
- preserve negative outcomes and rollbacks in calibration data.

## 13. Explainability payload

Every recommendation should be able to report:

```json
{
  "objective": "reduce time to verified monthly report",
  "expectedImpact": {"value": 0.22, "unit": "relative_reduction"},
  "probabilityOfSuccess": 0.78,
  "confidence": "high",
  "topEvidence": [
    "7 comparable completed reports",
    "6 verified successes",
    "same user/workspace/activity"
  ],
  "readiness": "ready",
  "riskClass": "low",
  "changeClass": "workflow_preference",
  "requiresConfirmation": true,
  "expiresAt": "2026-07-31T00:00:00Z"
}
```

## 14. Promotion criteria

A proposal may be promoted only when:

- success threshold passes;
- all guardrails pass;
- confidence meets class threshold;
- measurement window and minimum sample pass;
- no unresolved policy/security/privacy issue exists;
- rollback remains available;
- the authority epoch/base versions are current;
- required human decisions are recorded.

Failure to meet evidence thresholds results in `insufficient_evidence`, not a negative conclusion or silent promotion.
