# Issue #4957 — Cloudflare Read-only Evidence

**Observed at:** 2026-08-12

The Cloudflare account read-only inventory returned HTTP 200 with 10 tunnels. The inventory was performed through the Cloudflare account API and did not modify tunnels, DNS, routes, configurations, tokens, or connectors.

| Tunnel status | Count |
|---|---:|
| `healthy` | 1 |
| `down` | 3 |
| `inactive` | 6 |

The healthy tunnel has five active connections reported by Cloudflare. The three `down` tunnels have no active connections in the returned inventory. The tunnel names and connector identifiers are intentionally omitted from this repository evidence because they are operational identifiers not required to prove the aggregate state.

## Interpretation

This confirms that the Cloudflare account contains an active healthy tunnel as well as three down and six inactive tunnels. It does **not** prove which tunnel serves the public break-glass endpoint from Issue #4957, and it does not prove that the expected public route is attached to the healthy tunnel. The next safe read-only step is to correlate the expected hostname with Cloudflare DNS/tunnel configuration and then perform an external HTTP health check. No repair or routing mutation is authorized by this evidence.

## Zone and DNS correlation

The account contains one active zone, `mad4b.com`. A read-only DNS inventory returned 29 records. It includes the public connector hostname `connector.mad4b.com` and several `lc-*` local-connector hostnames backed by `cfargotunnel.com` CNAME targets. The DNS inventory also shows that at least one CNAME target maps to a Tunnel currently reported as `down`, while another maps to the single Tunnel currently reported as `healthy`.

This establishes a concrete correlation candidate for the HTTP 530 investigation, but it does not prove which hostname is the expected break-glass endpoint or whether the public endpoint is intentionally attached to a down Tunnel. A hostname-specific external HTTP read-only check and an operator-confirmed route identity are still required before any repair.

## Safety evidence

| Control | Result |
|---|---|
| API operation | Read-only `GET` tunnel inventory |
| Mutation executed | No |
| DNS change | No |
| Tunnel/configuration change | No |
| Token retrieval | No |
| Origin IPs persisted | No |
| Secrets included | No |
| Issue closure | Not claimed |

## Public HTTP read-only check

At `2026-08-12T14:31:45Z–14:31:56Z`, unauthenticated `HEAD /` checks returned:

| Hostname | HTTP result |
|---|---:|
| `connector.mad4b.com` | `530` |
| `lc-632b376e.mad4b.com` | `502` |
| `lc-8db63b00.mad4b.com` | `530` |
| `n8n.mad4b.com` | `530` |

The HTTP result confirms the externally observable failure pattern for Issue #4957 at the checked time. It does not authorize changing the Tunnel, DNS, origin, or routing. The next action requires identifying the intended service-to-Tunnel mapping and obtaining explicit approval for the smallest provider-side repair, followed by immediate readback.

## Ingress correlation readback

A read-only configuration readback provides a stronger correlation:

| Tunnel | Status | Hostnames observed | Service target |
|---|---|---|---|
| `f85825dd-5a0d-4e37-ad57-2d229b7eb0d6` | `down` | `connector.mad4b.com`, `n8n.mad4b.com`, `lc-8db63b00.mad4b.com` | `localhost:7070` for connector/local connector; `localhost:5678` for n8n |
| `9bc7d8b7-f3a9-4a29-86d3-7703c549c9d5` | `healthy` | `lc-632b376e.mad4b.com` | `127.0.0.1:7070` |

This identifies the likely root cause of the observed 530s: the affected public hostnames are configured on the Tunnel currently reported as `down`, while the healthy Tunnel serves a different local-connector hostname. It still does **not** authorize moving hostnames between Tunnels, because the two Tunnels may represent different machines or service owners. The correct next mutation is to restore the managed `cloudflared` service for the down Tunnel or obtain an explicit operator decision to rebind the hostnames.
