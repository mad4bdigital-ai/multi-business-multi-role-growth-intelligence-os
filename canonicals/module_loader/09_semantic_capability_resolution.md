## Semantic Capability Resolution Loader Dependencies

Before a semantic capability can be considered executable, `module_loader` must load and validate the complete tenant-effective dependency set.

### Required row collections

Load:

- semantic capability definition;
- ordered active provider bindings;
- canonical workspace and active membership;
- active workspace app links;
- linked active user app connections;
- action grants for the selected connection and parent action;
- workspace/resource authority grants;
- endpoint aliases and canonical endpoint rows;
- runtime dispatch certifications;
- existing endpoint tool exports and desired export projection.

### Selection rules

Connection candidates must be limited to the resolved tenant and workspace link. Apply deterministic ranking and block equal top-ranked candidates. An explicit connection ID is valid only when it is already linked to the resolved workspace.

Endpoint loading must map imported or historical aliases to one canonical endpoint key. Zero ready rows returns `canonical_endpoint_unavailable`; more than one ready canonical row returns `ambiguous_canonical_endpoint`.

### Loader completion gate

The loader returns a no-secret capability manifest containing the capability key, provider binding, selected connection metadata, canonical endpoint identity, authority evidence references, certification reference, export state, rollout mode, and deterministic manifest hash.

The loader must not return encrypted credentials, tokens, private keys, authorization headers, or provider request bodies.

A `shadow` binding may complete as `shadow_ready`, but it must not load a provider executor or activate an export. `canary` and `active` bindings still require current runtime certification, applicable approval, audit evidence, and readback configuration before provider execution.

### UEACP loader guard

For the Unified Effective Authority Control Plane, the loader may compose only the read-only resolver, connector projection repository, optional shadow-evidence repository, reconciliation service, and disabled-by-default scheduler. Loading these modules must not grant execution authority or change the legacy runtime decision.

The loader must preserve `authority_granted=false`, `enforcement_mode=shadow_only`, `legacy_runtime_authoritative=true`, `execution_authority_changed=false`, `provider_calls=false`, `credential_payload_reads=false`, `external_writes=false`, and `secrets_included=false`. Evidence persistence must remain unavailable until the ledger migrations exist and an evidence mode is explicitly enabled. No module load may infer live parity from zero pre-migration manifests or promote rollout state implicitly.
