# Acceptance Matrix

| ID | Scenario | Expected result |
|---|---|---|
| AC-01 | Runtime action is unavailable | `ready=false`, `runtime_action_not_ready` |
| AC-02 | Capability mapping is missing | `ready=false`, `capability_mapping_missing` |
| AC-03 | Resolver returns a tenant blocker | `ready=false` with stable blocker status |
| AC-04 | Resolver returns fully ready | `ready=true`, `dispatch_ready` |
| AC-05 | Resolver throws | `ready=false`, no secret or stack disclosure |
| AC-06 | Active system lacks active installation | counted pending, not active |
| AC-07 | Connector query fails | counts null and `available=false` |
| AC-08 | Connector query succeeds with no rows | counts zero and `available=true` |
| AC-09 | Dashboard connector data is unavailable | card is `unknown`, value is null |
| AC-10 | Dashboard connector count is known zero | card is `not_connected`, value is zero |
| AC-11 | Operational blockers exist | `blocked_surfaces > 0` |
| AC-12 | Blocked surfaces exist | authorization visibility is below 100 |
| AC-13 | No blocked/degraded/stale surfaces | awareness remains complete and near 100 |
| AC-14 | Public contract | existing fields remain; new fields are additive |
| AC-15 | Required CI checks | all four required checks pass before merge |
| AC-16 | Merge | reviewed head is merged to current `main` with ancestry readback |
