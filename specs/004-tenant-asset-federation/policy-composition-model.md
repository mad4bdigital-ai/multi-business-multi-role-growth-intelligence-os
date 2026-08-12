# Policy Composition Model

## 1. Why typed composition is required

A naive merge of policy documents can produce unsafe results. Different fields have different meanings:

- combining allowed workflows differs from combining denied operations;
- combining budgets differs from combining risk levels;
- combining prompts differs from combining approval requirements.

The platform therefore resolves registered policy atoms rather than arbitrary JSON objects.

## 2. Policy atom contract

Every composable field declares:

- `policy_family`
- `field_key`
- `value_type`
- `operator`
- `allowed_operators`
- `mandatory_floor`
- `source_layer`
- `priority`
- `scope`
- `validity`
- `risk_class`
- `explainability_template`

Unknown fields or unsupported operators block publication or resolution.

## 3. Context layers

Canonical order for explanation, not unconditional override precedence:

```text
platform_mandatory
→ tenant
→ workspace
→ brand
→ business_activity
→ role
→ user_preference
→ session_task
```

A layer participates only when it applies to the signed principal and resolved context.

## 4. High-level modes

### 4.1 Union

For eligible allow/catalog dimensions, union returns the distinct set present in any participating required layer.

Use cases:

- discoverable shared workflows;
- knowledge sources;
- non-sensitive tools;
- user-selected dashboard modules.

Union does not merge away denies, missing credentials, or required approvals.

### 4.2 Intersection

For eligible allow/capability dimensions, intersection returns only items allowed by every configured required layer.

Use cases:

- executable actions;
- agent availability for strict workspaces;
- endpoint and engine eligibility;
- regulated or tightly governed contexts.

A missing required layer is `composition_scope_missing`, not an implicit allow.

### 4.3 Guarded union

A user-friendly profile that unions positive candidates, then applies all mandatory and contextual restrictions. This is the recommended default for discovery and read-only capabilities.

### 4.4 Strict intersection

Requires agreement across all selected authority layers. Recommended for write, spend, credential-touching, legal, deployment, and destructive operations.

## 5. Typed operators

| Semantic type | Operator | Result |
|---|---|---|
| allowed set | union | all unique allows |
| allowed set | intersection | common allows only |
| denied set | deny_wins / set union | every deny remains effective |
| required validators | set union | all unique validators run |
| approval severity | maximum | strongest approval requirement |
| risk/sensitivity | maximum | highest risk or sensitivity |
| quota/budget ceiling | minimum | most restrictive ceiling |
| lower bound requirement | maximum | strongest minimum requirement |
| scalar preference | nearest_replace | nearest applicable value |
| explicit priority scalar | priority_replace | highest priority; ties must agree |
| ordered pipeline | stable_topological_merge | preserve dependencies and deterministic order |
| weighted preference | bounded_weighted_merge | normalized weights within registered bounds |
| prompt/knowledge fragments | ordered_append_dedupe | stable order, source attribution, token budget |
| boolean safety guard | false_wins or true_wins | registered conservative polarity |

## 6. Policy family examples

### Content generation

- shared workflows: guarded union;
- allowed output channels: intersection for regulated workspaces, union otherwise;
- required review: maximum;
- brand tone: nearest replacement from brand, with user presentation preference applied afterward;
- prohibited claims: accumulated deny set;
- language preferences: user ranking over brand-supported language set.

### WordPress publishing

- candidate actions: strict intersection;
- write permission: deny wins;
- Brand Core requirement: true wins;
- approval requirement: maximum;
- batch size: minimum;
- connection: nearest valid unambiguous binding;
- tenant credential: resolved only after authority.

### Analytics

- read connectors: guarded union;
- property/resource access: intersection;
- date range defaults: nearest replacement;
- export row limit: minimum;
- personally sensitive dimensions: deny wins.

## 7. User-selected composition profiles

A user may choose from platform-registered templates or define a custom profile within allowed bounds.

Example templates:

- `explore`: guarded union for read-only catalogs;
- `focused`: intersection for selected workflows and agents;
- `brand_strict`: brand and activity layers required;
- `role_strict`: role, workspace, and brand agreement required;
- `automation_safe`: union discovery plus strict execution intersection;
- `regulated`: mandatory intersection with strongest approval and minimum quotas.

The user may select a profile by dimension or policy family. One global mode for all fields is forbidden.

## 8. Role of preferences

User preferences may:

- rank effective agents and workflows;
- choose explanation depth and language;
- hide eligible items from personal views;
- choose among equivalent ready providers;
- select a composition profile.

They may not:

- add an unauthorized asset;
- remove a mandatory validator;
- increase a quota above authority;
- lower risk or approval requirements;
- select another tenant's connection;
- convert a blocked action into an executable action.

## 9. Conflict handling

Resolution blocks when:

- equal-ranked replacement values disagree;
- an intersection layer is missing;
- a selected operator is not allowed for the dimension;
- a variant modifies a mandatory field;
- graph paths produce different non-mergeable authority outcomes;
- multiple equally ranked connections or credentials exist;
- the authority epoch changes during resolution.

## 10. Explanation contract

Every effective field should report:

- final value;
- operator;
- contributing layers and row/version IDs;
- ignored or shadowed values;
- mandatory floor applied;
- user-selected profile;
- conflicts or restrictions;
- readiness consequence.

The explanation is no-secret and subject-scoped.
