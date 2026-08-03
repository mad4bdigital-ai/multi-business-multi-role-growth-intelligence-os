# External Integration and Workspace File Fabric Acceptance Matrix

Passing a mock or matching a UI is not sufficient. Provider-backed rows require real Sandbox or governed Staging evidence.

| ID | Capability | Acceptance requirement | Required evidence |
|---|---|---|---|
| EXT-001 | Domain authority | Exactly one active writer exists per scope/domain | DB uniqueness test and resolver readback |
| EXT-002 | Missing authority | Write blocks when no authority is selected | Stable `DOMAIN_AUTHORITY_MISSING` response |
| EXT-003 | Ambiguous authority | Two eligible writers block rather than selecting first row | `DOMAIN_AUTHORITY_AMBIGUOUS` test |
| EXT-004 | Authority drift | Stale plan is rejected after authority revision changes | Revision-conflict evidence |
| EXT-005 | Mapping | Canonical identity remains stable when external ID changes | Mapping migration test |
| EXT-006 | External ID safety | Caller external ID cannot grant authority | Negative authorization test |
| EXT-007 | Adapter certification | Uncertified adapter cannot become writer | Activation gate test |
| EXT-008 | Capability constraints | Unsupported operation blocks before provider dispatch | `ADAPTER_CAPABILITY_UNSUPPORTED` evidence |
| EXT-009 | Provider version | Incompatible API/mapping version blocks activation | Compatibility test |
| EXT-010 | No secrets | Tokens and raw headers absent from all evidence surfaces | Secret scanner and fixture assertions |
| INBOX-001 | Signature | Valid webhook accepted; invalid signature rejected | Provider fixture tests |
| INBOX-002 | Replay | Duplicate provider event is acknowledged but applied once | Inbox dedupe evidence |
| INBOX-003 | Scope binding | Event for wrong connection/tenant is rejected | Cross-scope negative test |
| INBOX-004 | Async boundary | HTTP acknowledgement does not perform final business mutation | Route/application separation test |
| INBOX-005 | Unknown outcome | Ambiguous event schedules readback and blocks replay | State transition evidence |
| INBOX-006 | Retry | Retryable processing failure uses bounded backoff | Attempt ledger evidence |
| INBOX-007 | Dead letter | Exhausted item enters dead letter without data loss | Dead-letter and recovery test |
| DRIVE-001 | Personal isolation | User A cannot access User B personal connection or files | Two-user denial suite |
| DRIVE-002 | Company ownership | Company file operation resolves exact company connection | Context/owner-scope evidence |
| DRIVE-003 | Brand ownership | Brand file operation cannot fall back to Workspace/personal write | Fail-closed test |
| DRIVE-004 | Connection ambiguity | Equal eligible Drive connections block | `CONNECTION_AMBIGUOUS` response |
| DRIVE-005 | Consent separation | Google Sign-In without Drive consent yields remediation state | `PROVIDER_CONSENT_REQUIRED` evidence |
| DRIVE-006 | Minimum scopes | Adapter requests only capability-required scopes | OAuth state/scope contract test |
| DRIVE-007 | List | List returns bounded page and stable next token | Live provider readback |
| DRIVE-008 | Search | Quotes and special characters are escaped; no query injection | Search fixture and provider test |
| DRIVE-009 | Metadata | File, folder, shortcut, native doc, and Shared Drive metadata normalize | Contract fixtures |
| DRIVE-010 | Binary read | Binary content is streamed and not coerced to UTF-8 text | Binary checksum test |
| DRIVE-011 | Native export | Docs/Sheets/Slides export follows representation matrix | Export readback evidence |
| DRIVE-012 | Folder create | Child folder is created under exact requested parent | Parent/name/MIME readback |
| DRIVE-013 | Small upload | Multipart upload preserves name, parent, MIME, size, checksum | Live provider readback |
| DRIVE-014 | Resumable upload | Interrupted large upload resumes without duplicate file | Fault injection evidence |
| DRIVE-015 | Idempotent upload | Same key and payload returns original result | Operation ledger/readback |
| DRIVE-016 | Idempotency conflict | Same key with different payload is rejected | Stable conflict response |
| DRIVE-017 | Rename | Rename uses expected version and verifies new name | Version and readback evidence |
| DRIVE-018 | Move | Move adds intended parent and removes old parent safely | Parent readback before/after |
| DRIVE-019 | Copy | Copy creates new canonical file with correct owner/parent | Identity and parent readback |
| DRIVE-020 | Trash | User delete defaults to trash and verifies trashed state | Mutation readback |
| DRIVE-021 | Restore | Trashed item restores once with correct parent/state | Mutation readback |
| DRIVE-022 | Permanent delete | General write capability cannot permanently delete | Step-up denial test |
| DRIVE-023 | Retention | Retention policy blocks prohibited deletion | Policy enforcement evidence |
| DRIVE-024 | Permission list | Permission output is bounded and secret-free | Projection schema test |
| DRIVE-025 | Internal sharing | Authorized internal grant is applied once and read back | Permission readback |
| DRIVE-026 | Public sharing | `anyone` grant is blocked or held for approval | Approval/denial evidence |
| DRIVE-027 | External domain | External-domain grant requires policy and approval | Approval path test |
| DRIVE-028 | Ownership transfer | Transfer is a separate step-up capability | Capability denial/approval test |
| DRIVE-029 | Permission removal | Permission is removed and verified | Readback evidence |
| DRIVE-030 | Inherited permission | Shared Drive inherited permission is not treated as directly removable | Constraint response |
| DRIVE-031 | Revision list | Revisions are bounded and tied to exact file | Live or certified provider evidence |
| DRIVE-032 | Revision restore | Restore/copy is not declared complete before content/version readback | Readback evidence |
| DRIVE-033 | Change cursor | Cursor is scoped to exact connection and space | DB and worker test |
| DRIVE-034 | Change dedupe | Duplicate change does not repeat projection mutation | Dedupe evidence |
| DRIVE-035 | Invalid cursor | Invalid cursor launches bounded reconciliation | Recovery workflow evidence |
| DRIVE-036 | Search ACL | Indexed search revalidates live authority | Permission-revocation test |
| DRIVE-037 | Deindexing | Trash/delete/permission removal updates index | Reconciliation evidence |
| DRIVE-038 | Batch folder tree | Folder tree creates only requested hierarchy | Manifest and parent readback |
| DRIVE-039 | Batch upload | Mixed files upload with per-item status | Operation item ledger |
| DRIVE-040 | Partial failure | One failed upload does not hide completed siblings | Counts and error evidence |
| DRIVE-041 | Resume | Retry resumes failed item only | No-duplicate assertion |
| DRIVE-042 | Archive | Historical copies move to Archive without authority widening | Parent/readback evidence |
| DRIVE-043 | Manifest | Manifest lists canonical refs, provider refs, names, types, parents, sizes, and checksums | Generated manifest file |
| DRIVE-044 | Reference case | Entire RetailOS demo package reference case completes | End-to-end Sandbox report |
| DRIVE-045 | Same-cycle readback | Consequential writes return verified or explicit pending/unknown state | API trace evidence |
| DRIVE-046 | Raw error safety | Provider raw response is not exposed to user/log | Fixture and log scan |
| DRIVE-047 | Rate limits | 429 is normalized and retried according to provider hints | Fault injection test |
| DRIVE-048 | Redis loss | SQL operation state reconstructs pending work | Recovery test |
| DRIVE-049 | Reconnect same account | Same provider account reconnect updates revision safely | OAuth reconnect test |
| DRIVE-050 | Reconnect different account | Different account replacement is rejected | Account-binding mismatch evidence |
| DRIVE-051 | Responsive UX | Core file operations work at mobile, tablet, and desktop widths | Visual and interaction tests |
| DRIVE-052 | Arabic RTL | Folder tree, status, errors, and recovery are usable in Arabic RTL | Locale acceptance test |
| DRIVE-053 | Accessibility | Keyboard, focus, labels, contrast, and live progress meet WCAG 2.2 AA | Automated and manual report |
| DRIVE-054 | Agent parity | Agent tool and UI call the same application service | Architecture test |
| DRIVE-055 | Credential exclusion | GPT/agent context never receives Drive credentials or signed upload secrets | Tool-output assertion |
| DRIVE-056 | SLOs | Availability, latency, queue lag, cursor freshness, and readback mismatch SLOs are measured | Staging dashboard evidence |

## Closeout rule

Spec 014 cannot claim Workspace File Fabric complete while any mandatory `EXT`, `INBOX`, or `DRIVE` row is missing evidence for the activated capabilities and topology.
