# CMS Authority Hardening Runbook

This runbook tracks the CMS authority cleanup path for WordPress/CMS publish grants.

## Required checks

- Duplicate active grant detection for `cms_site_access_grants`.
- Uniqueness hardening for active grants by site, tenant, user, connection, scope, and status.
- Collation mismatch documentation or corrective migration where joins require explicit collation.
- Grant-gate smoke cases:
  - valid grant allows the intended draft/publish operation
  - missing grant denies
  - wrong brand/site denies
  - revoked grant denies

## Safety

CMS hardening must not publish content during readiness checks. Use dry-run or sandbox operations until a separate publish capability envelope is approved.

## Scorecard role

The remaining-scope scorecard verifies that CMS authority hardening remains tracked and that CMS grant surfaces remain visible in the repository.
