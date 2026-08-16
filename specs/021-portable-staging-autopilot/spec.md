# Portable Windows Staging Auto Pilot

## Summary

This feature governs a reusable, one-click Windows Staging launcher running from an external NTFS SSD. It covers exact-commit eligibility, fail-closed integrity checks, Docker Desktop/WSL2 preflight, isolated Staging environment configuration, internal-only Docker ingress, and Cloudflare Tunnel exposure for the approved Staging hostnames.

## Scope

The implementation is limited to `autopilot-portable-staging/**`, the Staging-only Docker build and Compose files, and their contract tests. Production Compose, Hostinger deployment, Production databases, Production hostnames, Cloudflare DNS, and provider mutation remain outside the contract.

## Requirements

- Require an exact eligible `main` SHA before local execution.
- Reject overlapping Auto Pilot processes.
- Normalize only manifest-protected line-ending drift and reject real content changes.
- Build the Staging image from repository root so `canonical-manifest.mjs` is available at `/canonical-manifest.mjs`.
- Keep Staging application ingress internal to the Compose network; Cloudflare Tunnel uses `http://app:8080`.
- Persist structured operational logs and capture service diagnostics on health failure.
- Keep database migration and mutation flags fail-closed and false.

## Non-goals

This feature does not deploy Production, mutate Hostinger, change Cloudflare DNS, apply migrations, copy Production data, or include secrets in repository artifacts.
