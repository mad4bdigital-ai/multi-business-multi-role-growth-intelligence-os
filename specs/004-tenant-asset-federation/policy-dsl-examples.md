# Policy DSL and Resolution Examples

## 1. Purpose

The runtime needs a human-reviewable, machine-validatable representation of policy semantics. This document proposes a declarative policy atom format for design and contract discussion. It is not an authorization to introduce a new executable scripting language.

The DSL is constrained:

- data only;
- no loops, functions, imports, network access, or arbitrary code;
- registered fields and operators only;
- bounded arrays and object depth;
- JSON-schema validation;
- deterministic evaluation;
- explicit scope and provenance;
- no secret-like keys or values.

## 2. Policy atom example

```yaml
atom_key: wordpress.publish.batch_limit.brand
policy_family: wordpress_publishing
field_key: max_batch_size
semantic_type: integer_upper_bound
operator: minimum
value: 10
source_layer: brand
scope:
  tenant_id: tenant_123
  brand_key: dream_desert
priority: 100
mandatory: false
valid_from: 2026-06-01T00:00:00Z
expires_at: null
source:
  table: platform_engine_policy_rules
  row_key: wordpress_publish_batch_brand_v1
  version: 3
```

## 3. Registered field semantics

```yaml
policy_family: wordpress_publishing
field_key: max_batch_size
value_schema:
  type: integer
  minimum: 1
  maximum: 100
semantic_type: integer_upper_bound
default_operator: minimum
allowed_operators:
  - minimum
mandatory_floor: null
user_customizable: false
variant_customizable: false
safety_polarity: restrictive_lower_value
```

A profile cannot change `max_batch_size` from `minimum` to `maximum` because the field registry does not permit it.

## 4. Composition profile example

```yaml
profile_key: automation_safe
owner: platform
rules:
  - dimension_key: workflows
    composition_mode: guarded_union
    required_layers:
      - tenant
      - workspace
    optional_layers:
      - brand
      - business_activity
      - role
      - user_preference
    conflict_behavior: block

  - dimension_key: actions
    composition_mode: strict_intersection
    required_layers:
      - tenant
      - workspace
      - role
    conditional_required_layers:
      - when:
          risk_at_least: high
        layers:
          - brand
          - business_activity
    conflict_behavior: block

  - policy_family: wordpress_publishing
    composition_mode: typed_field_semantics
```

## 5. Guarded union example

Inputs:

```yaml
tenant:
  allowed_workflows: [seo_audit, analytics_report]
workspace:
  allowed_workflows: [wordpress_publish]
brand:
  denied_workflows: [wordpress_publish]
user_preference:
  preferred_workflows: [wordpress_publish, seo_audit]
```

Resolution:

```yaml
positive_union:
  - seo_audit
  - analytics_report
  - wordpress_publish
applicable_denies:
  - wordpress_publish
effective_allowed:
  - seo_audit
  - analytics_report
preference_ranking:
  - seo_audit
  - analytics_report
```

The user preference cannot restore the denied workflow.

## 6. Strict intersection example

Inputs:

```yaml
tenant.allowed_actions: [wordpress.read, wordpress.write]
workspace.allowed_actions: [wordpress.read, wordpress.write]
brand.allowed_actions: [wordpress.read, wordpress.write]
role.allowed_actions: [wordpress.read]
```

Result:

```yaml
effective_actions:
  - wordpress.read
excluded:
  wordpress.write:
    reason: missing_from_required_layer
    layer: role
```

## 7. Mixed typed fields example

Inputs:

```yaml
platform_mandatory:
  approval_severity: supervisor
  prohibited_claims: [guaranteed_results]
  audit_required: true

tenant:
  max_batch_size: 25
  approval_severity: manager
workspace:
  max_batch_size: 10
  required_validators: [link_checker]
brand:
  tone_profile: premium_adventure
  prohibited_claims: [cheapest_in_egypt]
activity:
  required_validators: [seo_schema_validator]
role:
  max_batch_size: 5
user_preference:
  tone_detail: concise
```

Result:

```yaml
max_batch_size:
  value: 5
  operator: minimum
approval_severity:
  value: supervisor
  operator: maximum
required_validators:
  value: [link_checker, seo_schema_validator]
  operator: union
prohibited_claims:
  value: [guaranteed_results, cheapest_in_egypt]
  operator: deny_wins
audit_required:
  value: true
  operator: true_wins
tone_profile:
  value: premium_adventure
  operator: nearest_replace
tone_detail:
  value: concise
  operator: preference_replace
```

## 8. Role and user distinction

```yaml
role:
  allowed_agents: [analytics_agent, publishing_agent]
user_preference:
  preferred_agents: [publishing_agent, analytics_agent]
```

Result:

```yaml
authorized_agents: [analytics_agent, publishing_agent]
ranked_agents: [publishing_agent, analytics_agent]
```

If the role allowed only `analytics_agent`, the ranked result would contain only `analytics_agent`.

## 9. Optional variant patch example

```yaml
variant:
  variant_key: nagy_reporting_preferences
  owner_scope_type: user
  owner_scope_ref: user_nagy
  base_asset_ref: workflow:monthly_growth_report
  base_version: 7
patches:
  - patch_type: reorder
    target_path: /sections
    value:
      - executive_summary
      - opportunities
      - blockers
      - detailed_metrics
  - patch_type: override
    target_path: /presentation/explanation_depth
    value: detailed
```

Forbidden patch:

```yaml
patch_type: override
target_path: /runtime/approval_required
value: false
```

Resolution: `VARIANT_PATCH_FORBIDDEN` because the path is mandatory/non-modifiable.

## 10. Conditional policy example

```yaml
atom_key: publishing.high_risk.requires_two_approvers
policy_family: wordpress_publishing
field_key: approval_severity
operator: maximum
value: two_distinct_approvers
condition:
  all:
    - field: operation.risk_class
      operator: in
      value: [critical]
    - field: operation.class
      operator: in
      value: [destructive, credential_touching, deployment]
```

Conditions support only registered facts and operators. Unknown facts block policy publication.

## 11. Business activity example

```yaml
activity: ecommerce_growth
policies:
  required_metrics:
    operator: union
    value: [revenue, conversion_rate, average_order_value]
  recommended_workflows:
    operator: guarded_union
    value: [product_feed_audit, conversion_funnel_analysis]
  max_experiment_spend:
    operator: minimum
    value: 500
  approval_severity:
    operator: maximum
    value: growth_operator
```

The activity layer can add requirements and recommendations but cannot override a lower tenant budget ceiling or a stronger approval level.

## 12. Effective explanation example

```json
{
  "fieldKey": "max_batch_size",
  "finalValue": 5,
  "operator": "minimum",
  "profileKey": "automation_safe",
  "contributors": [
    {"layer":"tenant","value":25,"source":"policy:tenant_publish_v2"},
    {"layer":"workspace","value":10,"source":"policy:workspace_publish_v4"},
    {"layer":"role","value":5,"source":"role:publisher_restricted_v1"}
  ],
  "ignored": [],
  "mandatoryFloorApplied": false,
  "readinessConsequence": "batch_size_limited"
}
```

## 13. Validation rules

- policy family and field must be registered;
- operator must be allowed for the field;
- value must match the registered schema;
- source scope must resolve to the same tenant unless platform-global;
- priority range is bounded;
- conditions use allowlisted facts/operators;
- recursive conditions and value depth are bounded;
- no secret-like keys or values;
- mandatory atoms require platform or approved tenant-policy authority;
- user preferences may write only fields marked user-customizable;
- variants may patch only registered modifiable paths;
- publication creates an immutable version and advances affected epoch/version evidence.

## 14. Determinism rules

- normalize strings, IDs, timestamps, and arrays before hashing;
- sort set-valued inputs by stable canonical key;
- preserve explicit ordered collections only for operators that require order;
- use decimal-safe arithmetic for weights and budgets;
- reject NaN, infinity, locale-dependent parsing, and ambiguous time zones;
- tie-break only with declared priority/specificity/version rules;
- never use database row order as a decision rule.
