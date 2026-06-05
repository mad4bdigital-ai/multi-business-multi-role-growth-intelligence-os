Schema Repair Governance

Safe additive repair is preferred over omission when a canonical migration,
registry contract, or runtime registry update references a useful missing schema
field.

Required decision order:
- attempt a non-destructive additive schema repair when the missing item is
  compatible and operationally useful
- record audit or migration-ledger evidence for the repair
- perform readback validation of the added item or policy row
- run release readiness after the repair
- use omission only as a temporary compatibility fallback when the additive
  repair is unsafe or blocked by preflight

Examples of useful additive repairs:
- `updated_at` audit timestamps on registry tables
- `metadata_json` fields for governed evidence
- readback timestamp or status fields needed by release-readiness checks

Blocked conditions:
- destructive DDL
- secret exposure
- runtime capability expansion without explicit certification
- large lock risk without a maintenance window
- contract-breaking backfill without approval

If a repair temporarily omits a canonical field to unblock validation, the next
platform action must either add the compatible field or open a tracked repair
item. Omission must not become the final canonical state.

The SQL authority row is:
`execution_policies.platform_repair_governance.safe_additive_repair_preferred_over_omission`.

The logic authority row is:
`logic_definitions.platform.schema_repair.safe_additive_preferred_over_omission`.
