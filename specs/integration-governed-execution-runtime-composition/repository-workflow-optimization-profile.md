# Repository Workflow Optimization Profile

## 1. Purpose

This profile applies the general composed-runtime architecture to repository inspection, patching, generation, validation, pull-request, CI, merge-readiness, and release-handoff workflows.

Repository work is a primary platform use case because the current primitives already support governed patching, expected branch SHA, overlap checks, semantic mutation, atomic Git tree/commit/ref updates, ephemeral checkout, short-lived credentials, PR lifecycle, CI evidence, and production readback. The optimization goal is to compose these capabilities into one governed plan rather than repeatedly returning to the model or rebuilding authority for each small operation.

This profile does not relax protected-branch, merge, deployment, migration, credential, or production gates.

## 2. Functional target

One request can express:

```text
Inspect the current repository state, identify the exact bounded repair,
prepare and validate all required changes and generated artifacts,
pause at the exact approval frontier, apply one atomic change set,
read it back, open or update the pull request, and follow the declared CI handoff.
```

The platform then continues server-side until:

- interpretation is required;
- approval is required;
- base/head/resource drift occurs;
- provider outcome is unknown;
- non-repairable CI failure occurs;
- merge/deploy/migration authority is separately required;
- workflow completes.

## 3. Canonical repository operation family

Logical operations may include:

- `repository.inspect`;
- `repository.read_files`;
- `repository.search_code`;
- `repository.compare_refs`;
- `repository.detect_overlap`;
- `repository.prepare_change_set`;
- `repository.semantic_patch`;
- `repository.generate_artifacts`;
- `repository.validate_change_set`;
- `repository.commit_change_set`;
- `repository.open_pull_request`;
- `repository.update_pull_request`;
- `repository.observe_ci`;
- `repository.diagnose_ci`;
- `repository.prepare_bounded_repair`;
- `repository.merge_readiness`;
- `repository.merge`;
- `repository.sync_production_branch`;
- `repository.release_readback`.

Operation keys are examples until aligned with the existing registry. Merge, protected branch mutation, production sync, deploy, and migration remain separately governed high-impact operations.

## 4. Repository Execution Capsule

Required exact context:

- authenticated actor/effective subject;
- owner and repository;
- base branch;
- work branch;
- expected base/head SHA;
- repository connection/credential readiness;
- branch protection and provider policy references;
- capability/authority revisions;
- tenant/workspace/resource scope;
- optional PR identity;
- expiry and invalidation dependencies.

The capsule does not store the credential or local checkout path.

## 5. Example governed plan

```text
R1 read repository/ref metadata --------+
R2 search relevant code ----------------+--> P1 compile repair plan
R3 inspect open PR overlap --------------+          |
R4 read generation/CI authority ---------+          v
                                              P2 prepare files/blobs
                                                   |
                                              P3 run local validation
                                                   |
                                              A1 approval frontier
                                                   |
                                              M1 atomic tree/commit/ref
                                                   |
                                              V1 branch/file readback
                                                   |
                                              M2 open/update PR
                                                   |
                                              W1 observe CI
                                                   |
                                              D1 structured diagnosis/repair frontier
```

R1–R4 and independent portions of P2 may run concurrently. M1 is serialized by repository/ref lock. M2 waits for M1 readback. W1 is durable/external-wait work.

## 6. Resource lock keys

Examples:

```text
repository:{owner}/{repo}:ref:{branch}
repository:{owner}/{repo}:pull_request:{number}
repository:{owner}/{repo}:release_branch:{branch}
repository:{owner}/{repo}:migration:{migration_id}
```

Rules:

- multiple reads may overlap;
- only one change-set mutation per target ref lock;
- PR metadata update and branch mutation may use separate locks when provider semantics allow;
- merge/protected branch/production sync use stricter locks and approval groups;
- unknown outcome after ref update retains a logical mutation guard until branch readback.

## 7. Preparation zone

Before approval, the platform should complete all safe bounded preparation possible:

- fetch current base/head SHAs;
- inspect exact files/regions;
- detect overlapping open PRs/branches;
- determine generator authority;
- prepare semantic transformations;
- create candidate file/blob content in memory or ephemeral workspace;
- run parser/schema/type/targeted tests where safe;
- compute file hashes, tree intent, and expected diff;
- classify risk and affected boundaries;
- prepare rollback/recovery note;
- compute plan/context/approval hashes.

No branch/ref mutation occurs in this zone.

## 8. Approval frontier

Approval bundle binds:

- repository owner/name/resource;
- base and work branch;
- exact expected base/head SHA;
- change-set file paths and content/blob hashes;
- generator outputs and source authority;
- allowed commit/ref/PR operations;
- maximum commits/mutations;
- risk class;
- merge/deploy/migration exclusions;
- expiry;
- readback and CI obligations.

Any change to file set, content hash, branch SHA, target ref, risk, generated output authority, or operation set invalidates approval.

## 9. Atomic change-set mutation

Preferred provider protocol:

1. reserve operation/step/idempotency/receipt;
2. validate expected branch SHA and overlap;
3. prepare missing blobs in bounded parallelism;
4. create one tree from exact base/tree;
5. create one commit with expected parent;
6. update exact branch ref with non-force expected-state semantics;
7. read back branch SHA, commit, tree, and changed paths;
8. finalize receipt/result/outbox.

When using local ephemeral checkout:

- checkout is isolated and `0700` or equivalent;
- credential is short-lived and worker/repository scoped;
- path/credential remain non-enumerable/internal;
- Git commands use argument arrays, not shell interpolation;
- cleanup and branch/readback are independent evidence obligations;
- local workspace is an execution dependency, not persistent authority.

## 10. Parallelization opportunities

Safe candidates:

- independent file reads;
- code search queries;
- open PR/branch comparison reads;
- schema/generator authority reads;
- independent candidate blob creation;
- independent parser/static validation;
- independent test shards when repository/CI policy permits;
- CI check observation after PR creation.

Must remain serialized or dependency ordered:

- branch ref updates;
- operations over same file/ref lock where stale input matters;
- generated artifact commit after source/generator completion;
- PR creation/update after branch readback;
- merge after final head/base/check/approval freshness;
- Production branch synchronization after exact Main state/authorization;
- migration apply after engine validation and checksum-bound approval.

## 11. Generated artifacts

Rules:

- identify canonical generator and source inputs;
- never hand-edit generated files when generator authority exists;
- run generation before approval when deterministic and safe;
- bind generated source digest and output hashes into change set;
- validate deterministic output;
- if generator output changes after approval, invalidate approval;
- CI remains final authority for repository-wide generated parity;
- avoid corrective follow-up commits by generating all known artifacts before M1.

## 12. Semantic patching

Prefer parser/structure-aware operations for:

- JSON;
- YAML;
- OpenAPI;
- completion/manifest files;
- code blocks with stable AST/anchors;
- import/registry/test-manifest changes.

Fallback sequence:

1. exact structured transform;
2. exact block replacement with precondition hash;
3. semantic patch operation;
4. bounded textual diff only when context is stable and validated.

Line-based patch failure after harmless drift triggers re-read/recompile, not unsafe fuzzy apply.

## 13. Repository idempotency

Scope includes:

- tenant/resource;
- owner/repository;
- target branch/ref;
- expected parent SHA;
- file/blob/tree intent hash;
- operation class;
- approval/plan hash.

Replay behavior:

- if branch already points to intended commit/tree, return prior/reconciled success;
- if idempotency key matches but change intent differs, conflict;
- if ref update outcome unknown, read branch/commit/tree before retry;
- PR creation uses branch/head/base/title or provider reference idempotency where available;
- CI observation is read-only and can resume by PR/head SHA.

## 14. Unknown outcome scenarios

### Ref update response lost

- receipt remains unknown;
- read target branch ref;
- compare intended commit/tree;
- confirm success or absence;
- never create another commit/ref update before reconciliation.

### PR create response lost

- search exact head/base and safe request fingerprint;
- confirm existing PR or absence;
- avoid duplicate PR.

### CI dispatch/observation transport failure

- identify workflow/run by head SHA/event/request reference;
- read current run/check state;
- do not repeatedly dispatch workflow unless absence is proven and policy allows.

### Production branch sync outcome unknown

- read Production ref and expected Main SHA;
- classify exact match/divergence;
- do not force update or repeat blindly.

## 15. CI orchestration

The durable lane owns:

- final synchronized head SHA;
- workflow run/check identities;
- check status/result;
- structured failure artifact/log references;
- superseded run cancellation where governed;
- bounded diagnosis;
- repair recommendation or approved repair frontier;
- final green-head evidence.

The model is used for non-deterministic failure interpretation only when structured diagnostics and deterministic repair mapping are insufficient.

## 16. Bounded repair loop

A repair loop declares:

- maximum cycles;
- allowed file/path scope;
- allowed risk/consequence;
- exact failure classes;
- change-size/mutation limits;
- whether existing approval covers repair;
- fresh expected branch SHA each cycle;
- CI/readback obligations;
- stop conditions.

A new approval is required when repair leaves the approved plan/file/risk boundary.

## 17. PR lifecycle

Managed lifecycle:

1. create branch from fresh base;
2. prepare/commit/read back change set;
3. open Draft or review-ready PR according to policy;
4. record head/base SHAs and changed files;
5. synchronize base when required;
6. run/observe final CI;
7. diagnose/repair within bounds;
8. perform human/agent review according to policy;
9. bind merge approval to current head/base;
10. merge only under separate exact authority;
11. delete branch if policy allows;
12. read back merge/default branch;
13. trigger/observe release or Production sync only as separately governed steps.

## 18. Merge and production boundaries

Not bundled into ordinary low-risk repository approval by default:

- protected branch merge;
- force push;
- Production branch synchronization;
- deployment/rebuild;
- migration apply;
- credential/permission change;
- external send/release publication.

Each requires its own operation consequence, approval, freshness, and readback contract.

## 19. Repository performance measures

Measure separately:

- active model/user interaction time;
- time to first compiled plan;
- time to approval frontier;
- preparation duration and parallelism;
- provider mutation/readback duration;
- time to PR;
- time to first/final CI result;
- repair cycles;
- tool/API/model round trips;
- GitHub/provider calls;
- file/blob read/create counts;
- corrective commit count;
- final wall-clock to green PR.

Expected target ranges remain engineering estimates until benchmarked:

- active interaction reduction: approximately 3x–10x;
- wall-clock to green PR: approximately 1.5x–4x depending on CI critical path;
- fewer corrective commits: target 30%–70% where pre-generation catches drift;
- Agent tool calls: at least 80% fewer for representative Spec 011 workstream target.

## 20. Repository acceptance scenarios

- four independent inspection reads overlap and produce deterministic plan;
- overlap/open PR detection blocks unsafe conflicting mutation;
- expected branch SHA drift invalidates approval;
- one atomic tree/commit/ref changes all approved files;
- generated artifacts match canonical generator output;
- ref update response loss reconciles without duplicate commit;
- PR create response loss reconciles without duplicate PR;
- ephemeral workspace/credential never serialized or leaked;
- worker crash cleans/reconciles workspace and branch independently;
- CI wait survives disconnect/restart;
- bounded repair remains inside file/risk limits;
- final merge approval invalidated by head/base change;
- Production sync requires exact separate authority and readback;
- legacy repository tool and composed operation produce equivalent change-set/receipt/readback for certified adapter;
- rollback routes new work to legacy while existing operation/result remains readable.

## 21. Delivery sequence

1. repository fixture instrumentation;
2. read/preparation DAG pilot;
3. change-set/approval compiler;
4. atomic mutation receipt/readback pilot on non-protected branch;
5. PR creation/readback;
6. durable CI observation;
7. bounded repair pilot;
8. intent-first Custom GPT adapter;
9. merge/release operations remain separately governed;
10. percent rollout and legacy usage analysis.