# Production Recovery canary readiness — Issue #7999

This slice turns the merged Production Recovery authority foundation, durable evidence adapters, and operational adapters into a bounded **canary-readiness decision**. It does not activate Production and it does not provision the Production Recovery Control Store.

## What the authority proves

`createProductionRecoveryCanaryReadinessAuthority()` has no caller-supplied evidence parameters. Its evidence is supplied only by deployment-owned readers. It re-evaluates:

- the complete operational adapter graph in `injected_non_live` mode;
- a fresh signed Staging Recovery certification;
- exact Staging-to-Production artifact parity;
- the exact server-managed Production deployment identity and read-only deployment attestation;
- governed Production Recovery Control Store provisioning/readback evidence;
- independent role-aware non-Production readback certification.

A successful result may set only:

```
canary_ready = true
```

It always keeps:

```
activation_eligible = false
production_live_enabled = false
production_mutation_authorized = false
execution_ticket_issued = false
approval_issued = false
```

## Why Control Store provisioning is separate

The existing resilient Recovery Control Store certification proves durability, replay resistance, fencing, restart persistence, and concurrency against disposable MariaDB. It does **not** prove that the Production Recovery Control Store has been provisioned.

The canary readiness gate therefore requires separate bounded evidence with contract:

```
mad4b.production-recovery-control-store-provisioning-evidence.v1
```

That evidence must prove governed authorization, schema readback, principal isolation, the canonical durable-store contract, exact Production SHA/target binding, and that Recovery live activation was not performed.

This source PR does not create the database, principal, schema, secret, or Hostinger configuration.

## Independent readback certification

The gate also requires:

```
mad4b.production-recovery-independent-readback-certification.v1
```

The certification must come from a live non-Production run of the same implementation SHA and must prove independent, role-aware, same-fence readback with no mutation authority.

## Post-merge operational sequence

After this source contract is merged, the governed sequence remains:

1. deploy the exact merged `main` to the non-Production certification target;
2. produce a fresh signed Staging Recovery Phase B certificate for that exact SHA;
3. independently certify the operational readback implementation on the same non-Production implementation SHA;
4. separately authorize and provision the dedicated Production Recovery Control Store, then collect bounded read-only provisioning/readback evidence;
5. read the exact server-managed Production deployment identity and read-only deployment attestation;
6. prove Staging-to-Production artifact parity;
7. evaluate the canary-readiness authority;
8. only if `canary_ready=true`, proceed to the existing Production activation-readiness evaluation;
9. require a separate explicit human Production activation authorization before any `production_live` transition.

## Still forbidden

This slice does not authorize or perform:

- Production Recovery activation;
- Production target database rebuild;
- #6813 Governance DB reconstruction;
- Migration 1051;
- GRANT/Raw SQL/SSH fallback;
- direct Hostinger mutation;
- caller-selected target, workflow, repository, host, database, credentials, or proof;
- synthetic replacement for signed Staging certification or live provisioning evidence.

A source merge is not canary evidence, and canary readiness is not Production activation authorization.
