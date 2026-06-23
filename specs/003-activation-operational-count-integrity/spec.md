# Specification

## Problem

Activation awareness currently reports `connected_system_count` as the sum of active, pending, and error systems. Production evidence shows 31 registered systems but only 3 operationally active installations. The response also reports three blocked surfaces without naming them or explaining their causes.

## Requirements

- `registered_system_count` MUST represent all non-archived classified systems.
- `connected_system_count` MUST represent only operationally active systems with active, non-expired installation evidence.
- Pending and error system counts MUST remain separately visible.
- `blocked_surfaces` MUST identify each blocked operational surface with stable reason codes and bounded metrics.
- Source failure MUST preserve null metrics rather than inventing zero.
- Responses MUST contain no secrets or credential material.
- Existing fields and routes MUST remain backward compatible.

## Acceptance

Given 3 active systems, 28 pending systems, 3 blocked tasks, and 10 skills requiring approval:

- registered systems = 31;
- connected systems = 3;
- blocked surfaces are exactly connectors, tasks, and skills;
- their reasons are pending installations, blocked tasks, and approval required.
