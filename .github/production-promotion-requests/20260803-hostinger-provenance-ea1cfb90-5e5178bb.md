# Governed Production synchronization request

- observed main SHA: `ea1cfb9024c8bce5608aa4576380aefee7141325`
- observed Production SHA: `5e5178bb7d5b86fe42a5eb97e647a5d65edaaceb`
- completion scope: Hostinger canonical deployment-manifest branch provenance repair from PR #5202
- incident: #4953
- requested policy: re-read both protected refs at execution time, construct an exact current-main tree candidate preserving current Production ancestry, run exact-candidate Full CI and all supporting gates, close stale candidate surfaces, and expose one authoritative Release PR
- merge requested by this artifact: false
- deployment requested by this artifact: false
- release activation requested by this artifact: false
- Hostinger restart requested: false
- migration execution requested: false
- provider calls requested: false
- credential payload reads requested: false
- database mutation requested: false
- external send requested: false
- secrets included: false

This marker only activates the permanent Governed Production Promotion Request Launcher. The launcher and post-finalization guard must fail closed and replay within their bounded policy if either protected ref moves. Any actual Production merge remains blocked until a separate explicit authorization names the exact candidate SHA. Runtime parity must be verified separately after an authorized Production merge.