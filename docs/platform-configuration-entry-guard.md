# Platform Configuration Entry Guard

## Purpose

The Platform Configuration Control Plane now has a fail-closed entry guard for new runtime configuration candidates. The guard prevents a developer from moving a value into the database merely to remove a hardcoded literal. A candidate must first be proven to be an operational setting rather than a secret, policy, generated artifact, or fixed contract.

## Required registration contract

Every new runtime setting changed in an application surface must have a metadata-only entry in `docs/governance/platform-configuration-entry-registry.json`. The entry must define a normalized `config_key`, a schema reference, an owner, a bounded risk class, one or more scope types, a binding reference, a resolver reference, a same-cycle readback reference, Shadow evidence, and a `shadow` or `staged` status.

The registry contains no operational values and no secrets. It does not activate a setting, write a database row, grant a privilege, call a provider, or promote a configuration. It is an admission and evidence contract for the later Config Catalog and federated registry workflow.

## Classification rules

| Candidate class | Guard decision | Correct destination |
|---|---|---|
| `runtime_setting` | Requires an exact metadata entry before merge | Platform Config Catalog and scoped binding |
| `policy_candidate` | Rejected from the general Config Catalog | Specialized policy registry and policy review |
| `secret_candidate` | Rejected and never copied to the registry | Environment/secret manager and rotation process |
| `generated_artifact` | Excluded from runtime setting registration | Generator plus drift/CI contract |
| `unknown_review_required` | Rejected until explicitly classified | Manual architecture review |

CI runs candidate discovery first, then this entry guard, then the existing platform resolver/adapter tests and configuration drift guard. A missing registration, invalid reference, duplicate key, unsafe status, secret flag, or safety flag causes the repository-tool lifecycle gate to fail closed.

## Safety boundary

The guard is registered as a `read_only` maintenance tool. It only reads candidate reports, changed-file metadata, and the metadata-only registry. Its report always declares `values_included=false`, `secrets_included=false`, `runtime_mutation_allowed=false`, `database_mutation_allowed=false`, and `production_activation_allowed=false`.

A passing guard is not a promotion approval. Before any setting can become active, the existing Config Catalog and Context Resolver contracts still require a governed database binding, scope precedence, ambiguity handling, same-cycle readback evidence, Shadow parity, independent review, and a separate activation gate.

## Developer workflow

When adding a new operational setting, first classify it. If it is a genuine runtime setting, add only its metadata entry and the associated schema, binding, resolver, readback, and Shadow evidence references. Do not add the value or secret to the registry. Run candidate discovery, the entry guard regression, the resolver/adapter tests, and the repository-tool lifecycle checks. The setting remains `shadow` or `staged` until a later, separately approved promotion.
