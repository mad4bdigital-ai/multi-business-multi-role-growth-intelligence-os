# Repository workflow runner-context registration

## Failure mode

GitHub Actions evaluates workflow-level and job-level expressions before a runner is allocated. A runner-context expression in those locations can prevent the workflow from registering and produce a completed failure with zero jobs and no runner logs.

## Proven inventory

A read-only audit of 131 workflow files on `main@ba10f269e831efa2c210b2729d1b31723a171052` found twelve invalid bindings across nine workflow definitions:

- Governed Migration Dependency Gate;
- Governed Production Promotion Post-Finalization Guard;
- Governed Production Promotion Request Launcher;
- Hostinger Completed Build Log Evidence R3C Push;
- Hostinger Completed Build Log Evidence R3C Windows;
- Hostinger Node.js Completed Build Log Evidence;
- Hostinger Production Release Evidence R5;
- Governed Response Chunk Ownership Rollout Push Bridge;
- UEACP Live Authority Evidence One Shot.

`Certified Production Release Cut Validation` was reviewed and contained no pre-allocation runner-context binding, so it is excluded from the repair scope.

## Repair contract

Evidence paths are established only after runner allocation through `$RUNNER_TEMP` and `$GITHUB_ENV`, or through a stable repository-relative `.artifacts/**` path whose parent is created before writing.

The repair preserves existing triggers, exact SHA bindings, permissions, authorization tokens, provider methods, protected-ref checks, and external-action boundaries.

## Repository-wide regression

The executable regression enumerates every YAML workflow under `.github/workflows`, tracks YAML indentation and Steps boundaries, and rejects every `${{ runner.* }}` expression outside a runner-backed Step. It is repository-wide rather than a fixed filename allowlist, so newly added workflows are covered automatically.

For the nine repaired workflows, the regression also requires a bounded post-allocation `$RUNNER_TEMP` path or stable `.artifacts/**` evidence location.

## Safety boundary

This registration repair performs no Production mutation, Hostinger/provider request, deployment, restart, credential read, SQL, Migration Apply, database mutation, protected-ref update, force push, issue-comment activation, or external business write. Provider-capable workflows remain inert unless their existing exact authorization contracts are separately satisfied.

## Lifecycle convergence

The repository lifecycle guard identified four incident-specific push bridges with hard-coded pull-request or branch identity. They are retired rather than converted into reusable mutation surfaces:

- `hostinger-nodejs-completed-build-log-evidence-push-r3b.yml`
- `hostinger-nodejs-completed-build-log-evidence-r3c-windows.yml`
- `response-chunk-ownership-governed-rollout-push.yml`
- `ueacp-live-authority-evidence-one-shot.yml`

The retained Production promotion launcher is manual-only. It requires typed authorization, an exact trusted workflow SHA, an exact request-PR head SHA, and explicit non-protected branch prefixes. The post-finalization guard no longer searches or closes PRs through hard-coded work-branch namespaces; it acts only on the exact release PR bound in validated convergence evidence.
