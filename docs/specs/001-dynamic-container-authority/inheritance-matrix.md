# Inheritance, Sharing, and Delegation Matrix

Inheritance is dimension-specific. No universal child-overrides-parent rule applies.

## Global rules

1. Every active containment path contributes.
2. Deny and restrict propagate down and win across paths.
3. A child may narrow authority but cannot widen it without override.
4. Sharing is read-only by default and does not affect ancestry.
5. Delegation is explicit, operation-bounded, and audited.
6. Secret values never participate; only binding references may.
7. Equal-precedence replacement conflicts block.

| Dimension | Containment inheritance | Sharing | Write behavior | Merge strategy |
|---|---|---|---|---|
| Roles | Parent ceiling; child narrows | No implicit sharing | Explicit assignment | intersect + deny_wins |
| Connections | Eligibility/reference only | Metadata read | Explicit link + action grant | nearest eligible; ambiguity blocks |
| Credentials | No value inheritance | Never payload-shared | Materialize after allow | exact binding |
| Tools | Catalog may inherit | Discovery read | Mutation needs authorization | union catalog, intersect execute |
| Skills | Availability may inherit | Discovery | Principal/agent grant | union availability, deny_wins execute |
| Rules | Inherit down | Reference | Child only tightens | deny_wins |
| Policies | Inherit down | Explicit reference | Relaxation needs override | most restrictive |
| Profiles | Declared overlay | Explicit read share | Local/delegated writes | nearest ancestor; conflict blocks |
| Classifications | Registry-defined | Optional | Local assignment | declared strategy |
| Knowledge | Configurable read | Read-only default | Local/delegated write | union + visibility filters |
| Brand Core | Brand descendants | No cross-brand default | Explicit delegation | nearest brand authority |
| Logic | Availability | Explicit reference | Compatibility required | candidate union + deterministic select |
| Engines | Availability | Explicit reference | Risk/quota gates | compatible intersection |
| Workflows | Template availability | Template read | Runtime binding + grant | union; ambiguity blocks |
| Actions | Capability projection | Metadata read | Action grant | intersect |
| Endpoints | Follow action | Metadata read | Exact endpoint/risk policy | canonical identity |
| Budgets | Ceiling | No implicit sharing | Spend authority | minimum ceiling |
| Quotas | Parent + child constraints | No implicit sharing | Debit all meters | minimum allowance |
| Assets | Configurable read | Read-only default | Explicit delegation | union reads, local write |
| Agents | Availability | Explicit delegation | Supervision + skills | compatible intersection |

## Multi-parent algorithm

```text
1. Load every active containment path to eligible roots.
2. Validate tenant and relationship rules.
3. Load classifications, roles, and bindings on every path.
4. Partition by dimension.
5. Apply registered merge strategy.
6. Add explicit read-only shares.
7. Add exact-operation delegations.
8. Apply all denies and restrictions.
9. Block unresolved equal-precedence conflicts.
10. Produce path evidence and snapshot hash.
```

## Examples

```text
Workspace admin + Brand viewer → viewer inside Brand
Parent publish allow + Parent publish deny → deny
Shared connection without delegation → metadata visible, provider write blocked
Exact drive.file.create delegation → eligible for later envelope and credential stages
```
