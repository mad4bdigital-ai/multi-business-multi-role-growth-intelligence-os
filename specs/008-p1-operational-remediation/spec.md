# Spec 008: P1 Operational Remediation Father Spec Kit

## Purpose

Group the open P1 operational-remediation work into one father specification and a sequence of bounded child PRs. This father PR is documentation and planning only. It must not enable provider execution, deployment, spend, publishing, credential reads, runtime grants, or direct writes to protected branches.

## Scope

In scope:

- Define child PR order, acceptance criteria, and closeout evidence.
- Keep every child PR narrowly scoped and independently testable.
- Require same-cycle readback before any alert is marked recovered.
- Preserve no-secret and no-provider-call guarantees in planning surfaces.

Out of scope:

- Runtime code mutation.
- Provider calls.
- Credential promotion.
- Deployment execution.
- Spending or campaign changes.
- Bulk closing operational alerts without evidence.

## Alert families

1. Hostinger SSH deploy and probe readback.
2. Credential intake handoff continuation.
3. OpenClaude provider bridge transport.
4. Deployment reliability receipts and SHA revalidation.
5. GitHub CI recovery.
6. Admin DB update serialization.
7. Deploy intent alignment.
8. Capability envelope lifecycle tooling.
9. Google Ads execution readiness gates.

## Success definition

Spec 008 is successful when the father PR is merged and every child PR has a clear implementation target, test contract, readback contract, and operational-alert closure rule. Alert resolution is not claimed by this father PR.
