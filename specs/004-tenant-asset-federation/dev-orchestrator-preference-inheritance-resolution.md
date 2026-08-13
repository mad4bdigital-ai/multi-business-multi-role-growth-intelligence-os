# Dev Orchestrator Preference Inheritance and Resolution

**Status:** design-only. Preferences rank eligible execution choices; they never create authority.

## 1. Scope hierarchy

```text
platform
→ tenant
→ workspace
→ business_activity
→ brand
→ workflow
→ agent
→ user
→ conversation
→ run
```

The resolver creates an immutable preference snapshot for each run.

## 2. Precedence

Resolution is not simple last-write-wins. The enforced order is:

1. platform safety and runtime hard constraints;
2. capability, credential and dependency availability;
3. business-activity compatibility;
4. tenant governance, privacy and budget limits;
5. workspace and brand policy;
6. workflow policy;
7. agent profile;
8. user preferences;
9. conversation override;
10. run override.

A lower scope may narrow or rank allowed choices but cannot broaden a hard-denied set.

## 3. Composition operators

- `inherit`: use the parent value.
- `override`: replace a soft value within the allowed domain.
- `append`: add eligible values while preserving parent entries.
- `restrict`: intersect with the parent allowed set.
- `deny`: remove values; deny wins.
- `require`: require an eligible capability or block.

## 4. Preference record

```json
{
  "scope_type": "user",
  "scope_id": "user_123",
  "preference_key": "execution_lane_order",
  "value": ["chatgpt_workspace_agent", "chatgpt_custom_gpt", "hermes_local", "openrouter"],
  "constraint_mode": "soft",
  "inheritance_mode": "override",
  "priority": 70,
  "revision": 4,
  "valid_from": "2026-07-01T00:00:00Z",
  "valid_until": null
}
```

## 5. User-customizable preferences

Users may configure, within tenant limits:

- preferred agent surface order;
- official API versus Browser Bridge preference;
- cloud versus local execution;
- preferred Workspace Agent, Custom GPT or Gemini Gem;
- cost, quality and latency bias;
- browser bridge opt-in for scheduled work;
- session reuse policy;
- preferred agents and maximum agent count;
- sequential versus parallel execution;
- paid-fallback behavior;
- output format and language;
- default starters and workflows;
- notification and approval interaction style;
- privacy strictness above the tenant minimum.

## 6. Non-overridable controls

Users cannot override:

- tenant isolation;
- credential access rules;
- denied tools and domains;
- cross-tenant sharing restrictions;
- tenant budget ceilings;
- data retention boundaries;
- act/authority approval requirements;
- sandbox and readback requirements;
- production deployment or migration authority.

## 7. Candidate scoring

After hard filters, candidates may be ranked using:

```text
score =
  quality_weight × expected_quality
- cost_weight × estimated_cost
- latency_weight × expected_latency
+ reliability_weight × recent_success_rate
+ privacy_weight × privacy_score
+ preference_weight × preference_match
+ context_reuse_weight × cache_or_session_reuse
```

Scores are explainable and do not suppress exclusion reasons.

## 8. Surface-specific signals

Browser surfaces add:

- login and session health;
- queue depth;
- UI compatibility version;
- recent extraction success;
- rate-limit or challenge state;
- exact target availability.

Local runtimes add:

- device/worker health;
- sandbox readiness;
- model capacity;
- available skills;
- memory-policy compatibility;
- provider and tool health.

Official API surfaces add:

- API availability and quota;
- supported operation set;
- callback/readback support;
- workspace or connection scope.

## 9. Example

Platform denies Browser Bridge for `act`. Tenant allows Browser Bridge, Hermes and OpenRouter for proposal work. Workflow prefers local execution. User prefers ChatGPT Custom GPT.

For a proposal run the ordered set may be `hermes_local`, `chatgpt_custom_gpt`, `openrouter`. For an act run Browser Bridge is excluded regardless of the user preference.

## 10. Persistence and reuse

Future implementation should first reuse `user_agent_surface_preferences`, tenant surface deployment records, workflow runtime bindings and existing policy registries. New persistence is justified only where the current schema cannot represent typed scope, operator, revision and validity semantics.

## 11. Audit

Every run records the preference sources read, revisions applied, effective values, exclusions, final ranking, user-visible explanation and whether fallback altered the selected candidate.

PR #1898 writes no preference rows and activates no defaults.