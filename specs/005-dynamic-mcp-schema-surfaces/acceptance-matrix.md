# Acceptance Matrix

| ID | Requirement | Pass condition | Current status |
|---|---|---|---|
| A001 | SQL authority | Dynamic schemas originate from governed SQL projection | Verified baseline; unchanged by this PR |
| A002 | Determinism | Same commit yields identical artifact hashes | Pass |
| A003 | Tenant defect | No null/empty property schema | Pass |
| A004 | Admin isolation | Admin-only tools visible only to admin | Fixed-surface pass; live principal catalog comparison pending |
| A005 | Tenant isolation | Real tenant JWT sees no admin-only tools | Pending real tenant JWT evidence |
| A006 | Version conflict | Breaking stale version returns conflict | Pending SQL contract phase |
| A007 | Input validation | Current SQL schema enforced | Existing runtime; dedicated phase evidence pending |
| A008 | Output validation | Invalid normalized output blocked/audited | Pending SQL contract phase |
| A009 | Surface separation | Host/auth/operations match registry | Pass |
| A010 | Budgets | Warning reported; hard limit blocks | Partial: hard limits pass; Tenant Core warning is active at 28/30 |
| A011 | Parity | Generated equals committed byte-for-byte | Pass |
| A012 | Edge no-DB | No SQL/secret/membership code at edge | Pass |
| A013 | Route guard | Unknown/ambiguous/encoded path blocked | Pass |
| A014 | Query guard | Undocumented query key returns 400 | Pass |
| A015 | Header guard | Cookie/hop-by-hop not forwarded | Pass |
| A016 | Redirect guard | Redirect becomes structured 502 | Pass |
| A017 | Stale mutation | Expired manifest blocks mutation | Pass |
| A018 | Signature | Tampered manifest rejected | Pass |
| A019 | Binding integrity | Zero unexplained callable gaps | Verified baseline for covered bindings |
| A020 | Lifecycle | Selected authority tables classified | Pending |
| A021 | Compatibility | Legacy caller works through dual-run | Alias retained; dual-run pending |
| A022 | Rollback | Prior schema/manifest restored | Pending rehearsal |
| A023 | No secrets | No token/cookie/credential leakage | Pass in static and gateway tests |
| A024 | SQL classification | SELECT read-only; mutations remain gated | Pending separate Tool Bus fix |

Mandatory production identities remain: backend admin key, active tenant JWT, and negative tenant JWT. Admin results cannot satisfy tenant rows.
