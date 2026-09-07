# Combined Recovery Phase B PR delivery

This PR is intentionally repository-only. It closes the repository-side Staging Phase B certification pipeline and Local Manager diagnostics needed before a live certification can be produced on the current exact `main` deployment.

It does not claim that the six live external-evidence checks are already true, does not dispatch the countersign workflow while under review, does not publish a live certificate, does not enable Production Recovery live composition, and does not mutate Production databases.

After merge, the governed operational sequence is:

1. update the Staging Windows checkout to the new exact `main` SHA;
2. collect genuine same-SHA registration/OAuth/network/Worker/ingress evidence;
3. run the exact-main local genuine canary and dispatch the manual countersign;
4. after the GitHub countersign succeeds, publish that exact signed record back into the Staging independent readiness store;
5. re-read Staging readiness and require `certification.valid=true` before any Production live-composition release;
6. only then complete the separate Production independent-store/live-authority deployment and re-run Production readiness;
7. do not execute schema or grant mutations until Production `activation_eligible=true` and a fresh human-approved Recovery step exists.
