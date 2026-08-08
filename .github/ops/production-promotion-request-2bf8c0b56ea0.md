# Governed Production Promotion Request

- requested_main_sha: `2bf8c0b56ea05b50650938400ca3e32ca11f52ee`
- observed_production_sha: `70dd049a42380116773d45d3283e1ff55e4043a8`
- request_scope: create governed Production synchronization request surface only
- protected_ref_mutation_authorized: `false`
- production_mutation_authorized: `false`
- force_push_authorized: `false`

This request surface does not authorize merging, deployment, protected-ref mutation, or Production mutation. The governed launcher requires a separate exact request-PR head binding and typed confirmation `AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST` before candidate convergence may run.
