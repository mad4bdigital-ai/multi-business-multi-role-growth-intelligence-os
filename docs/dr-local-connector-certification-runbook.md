# DR Local Connector Certification Runbook

This runbook tracks Disaster Recovery certification for the local connector.

## Required connector aliases

- `db_restore_certify_probe`
- `n8n_restore_certify_probe`

## Certification states

- `dr_ready`: required aliases exist and isolated probes pass.
- `dr_blocked_missing_aliases`: connector allowlist does not expose the required aliases.
- `dr_blocked_probe_failed`: aliases exist but isolated probe execution failed.

## Safety

Certification probes must be isolated and non-destructive. Do not run production restore or overwrite live state from an automation scorecard.

## Next step

When aliases are missing, run the governed local connector installer/safe upgrade for the target device, then re-run alias discovery and isolated probes.
