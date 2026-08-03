# Governed Production synchronization request

- observed main SHA: `2c7f069019ad7f0e590d201740dd58afbb51c5a4`
- observed Production SHA: `5e5178bb7d5b86fe42a5eb97e647a5d65edaaceb`
- completion scope: Hostinger canonical deployment-manifest Production branch provenance repair from PR #5202, plus the current safe main snapshot
- requested policy: re-read both protected refs at execution time, construct an exact current-main tree candidate, preserve current Production ancestry, run exact-candidate Full CI and supporting gates, then expose one authoritative Release PR
- merge requested by this artifact: false
- deployment requested by this artifact: false
- migration execution requested: false
- provider calls requested: false
- credential payload reads requested: false
- secrets included: false

This marker only activates the permanent Governed Production Promotion Request Launcher. The launcher and post-finalization guard must fail closed and replay within their bounded policy if either protected ref moves. The resulting release must not be authorized until it contains PR #5202 and exact-candidate evidence is green.