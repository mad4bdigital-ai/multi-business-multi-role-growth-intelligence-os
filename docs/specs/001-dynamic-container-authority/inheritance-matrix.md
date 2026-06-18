# Inheritance, Sharing, and Delegation Matrix

No universal child-overrides-parent rule applies.

## Global rules

1. Every active containment path contributes.
2. Deny/restrict propagates down and wins across paths.
3. A child may narrow but cannot widen authority without override.
4. Sharing is read-only by default and does not affect ancestry.
5. Delegation is explicit, operation-bounded, and cannot exceed delegator authority.
6. Secret values never participate; only binding references may.
7. Equal-precedence replacement conflicts block.
8. Limit exhaustion or epoch drift blocks rather than returning a partial allow.

| Dimension | Inheritance | Sharing | Write behavior | Merge |
|---|---|---|---|---|
| Roles | Parent ceiling; child narrows | None | Explicit assignment | intersect + deny_wins |
| Connections | Eligibility/reference | Metadata read | Link + action grant | nearest eligible; ambiguity blocks |
| Credentials | No value inheritance | Never payload-shared | Materialize after allow | exact binding |
| Tools | Catalog may inherit | Discovery | Authorization required | union catalog, intersect execute |
| Skills | Availability may inherit | Discovery | Principal/agent grant | union availability, deny_wins execute |
| Rules | Inherit down | Reference | Child only tightens | deny_wins |
| Policies | Inherit down | Reference | Relaxation needs override | most restrictive |
| Profiles | Declared overlay | Explicit read | Local/delegated writes | nearest; conflict blocks |
| Classifications | Registry-defined | Optional | Local assignment | declared strategy |
| Knowledge | Configurable read | Read-only default | Local/delegated write | union + visibility |
| Brand Core | Brand descendants | No cross-brand default | Explicit delegation | nearest brand authority |
| Logic/Engines | Availability | Reference | Compatibility/risk gates | compatible intersection |
| Workflows | Template availability | Template read | Runtime binding + grant | union; ambiguity blocks |
| Actions/Endpoints | Capability projection | Metadata | Exact grants/policy | intersect/canonical identity |
| Budgets/Quotas | Ceiling/constraints | None | Spend authority | minimum |
| Assets | Configurable read | Read-only default | Explicit delegation | union reads, local write |
| Agents | Availability | Explicit delegation | Supervision + skills | compatible intersection |

Examples:

```text
Workspace admin + Brand viewer → viewer inside Brand
Parent publish allow + Parent publish deny → deny
Shared connection without delegation → metadata visible, write blocked
Equal-distance profile replacements with equal priority → ambiguity block
```
