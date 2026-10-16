# Issue #8534 — Native Windows Staging Broker host bootstrap

## What was implemented

The independent Windows Service Control Manager host is a **credential-free
bootstrap only**, not a privileged MariaDB broker. C# `ServiceBase` requires
no unsigned third-party NSSM wrapper. The service's only possible operation
is to enter and leave SCM's service loop. It never reads files, binds sockets,
loads private keys, creates DBA principals, executes SQL or dispatches
Backup/Restore. Its self-test returns `operational_broker=false`.

A source-level operator installer offers a **read-only plan by default**.
A separate explicit `-Apply` path requires an elevated administrator
token, an exact deployed/certified GitHub main source SHA, exact copied
executable SHA-256, a virtual Windows service identity, and the scope
`STAGING_INERT_SERVICE_ONLY_NO_DBA`. Installation is manual-start only,
uses a protected ProgramData directory (system/administrators write;
the service identity reads), and never enables an admin adapter.

Never run an unsigned NSSM wrapper as LocalSystem to simplify setup.

## Actual device outcome — 16 October 2026

Windows host `DESKTOP-91FDEFP` is connected but the available desktop
session reports `IsElevated=false`; dedicated named service absent.
Windows built-in .NET Framework compiler and `System.ServiceProcess`
are available. The native host compiled locally, passed `--self-test`,
refused unauthorized interactive startup, and produced a measured
SHA-256. The read-only install plan verified the published Staging source
and the binary, and returned `can_apply_under_current_token=false`.
Actual `-Apply` was refused at
`BROKER_WINDOWS_ADMINISTRATOR_REQUIRED` with **no service registered**.
No OS elevation or security-control bypass was attempted.

The compiled EXE lives in the current user's temporary build directory.
It is **not** production-ready signed evidence, not an installed service,
not secret material and not itself a permanent release artifact.

## Source/build and future governed installation

After **this new PR** is reviewed, merged and independently deployed to
Staging with an exact current SHA, an administrator can perform a
separately authorized inert **OS service only** installation:

```powershell
$repo = 'M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os'
$sha = '<exact CURRENT certified Staging/main SHA>'
powershell.exe -NoProfile -ExecutionPolicy Bypass `
 -File "$repo\autopilot-portable-staging\Build-StagingBackupBrokerHostService.ps1" `
 -RepositoryPath $repo

# Read build output to obtain EXACT measured EXE SHA-256 and path.
# First perform read-only plan; must verify SHA, staging state and binary.
powershell.exe -NoProfile -ExecutionPolicy Bypass `
 -File "$repo\autopilot-portable-staging\Install-StagingBackupBrokerHostService.ps1" `
 -RepositoryPath $repo -ExpectedCommit $sha `
 -BinaryPath '<built EXE full path>' -ExpectedBinarySha256 '<measured sha256>'

# Only after approved source deployment and an elevated Staging operator
# session, repeat with explicit operation scope:
# -Apply -OperationScope STAGING_INERT_SERVICE_ONLY_NO_DBA
```

The installer refuses existing service, hash/commit mismatches, unknown
host, uncleared OS admin privilege or unapproved operation scope. Do not
automate UAC, use a shared LocalSystem account or bypass Windows ACLs.
The binary digest is a measurement, not independent publisher signature.

## Windows PowerShell 5.1 SCM registration failure — safe recovery

An elevated Windows install attempt on 2026-10-16 failed at
`BROKER_WINDOWS_SERVICE_REGISTRATION_FAILED` and left the protected
`%ProgramData%\MAD4B\StagingBackupBrokerHost` directory containing a copied
host EXE, while the named SCM service was **not registered**. The old installer
passed `password= ''` to `sc.exe create`. Windows PowerShell 5.1 silently
omits the empty native argument, yielding an invalid `password=` option.
A virtual `NT SERVICE\<service-name>` account requires a null password:
the corrected installer **omits the password option entirely**.

Do not delete, loosen ACLs on, or adopt this partial directory by default.
The corrected installer requires an **explicit**
`-ResumeInterruptedRegistration` flag. Before any SCM write, it requires:
exact repository/origin/deployed SHA, exact source binary SHA-256, genuinely
elevated Windows token, Staging inert-only scope, service absent, no reparse
points, exactly one expected copied EXE, exact copied EXE SHA-256, and a
protected ACL that grants FullControl to SYSTEM and Administrators only.
Any mismatch refuses recovery without changing the directory or service.
The original caller-supplied binary is **never executed** by the installer.

In a separately authorized **elevated** PowerShell window, after review
and source certification, use the normal installer invocation from above
with `-Apply -ResumeInterruptedRegistration` and
`-OperationScope STAGING_INERT_SERVICE_ONLY_NO_DBA`. The exact
`ExpectedCommit` must match current deployed/certified `main`; the
`ExpectedBinarySha256` must be freshly measured, not blindly reused from
a prior incident. A failed `sc.exe create` reports only the native exit
and Win32 status codes, never broad native output or credentials.

This recovery does not authorize DBA, MariaDB changes, backup/restore,
or any Production operation.

## Operational certification remains separate

After the inert SCM service exists, it can satisfy only *service presence*
and OS-process observation gates in
`Inspect-StagingBackupBrokerTrustReadiness.ps1`. It will still report
`broker_operationally_certified=false`,
`db_admin_operation_authorized=false` and unmet requirements for
independent host binary/ACL attestation, controlled runtime-db endpoint,
`backup_grant_service` identity/secret custody, an externally pinned
Ed25519 public verifier, immutable audit and one-shot signed operation
approval. Real backup, isolated restore and the 18 OA/MC acceptance cases
are distinct operations requiring independent authority.

This PR does not install a service, connect a database, change Docker
networks or deploy Production. The official Staging release remains the
source of truth for health/certification and must not be confused with
the separately compiled Windows service source branch.

## 2026-10-16 post-install readback and memory incident

The Owner's elevated PowerShell readback and a separate unprivileged SCM
observation showed `Mad4B-Staging-Backup-Db-Broker` RUNNING as
`NT SERVICE\Mad4B-Staging-Backup-Db-Broker` (manual start, PID 18316),
with the expected installed EXE SHA-256
`8771be99cb7a54b58cc7a5ab11fb3dc095429f7c7832b7346981c9921045144a`.
The directory has protected DACL, with three exact Allow grants:
SYSTEM and Administrators FullControl (2032127), and the virtual
service account ReadAndExecute+Synchronize (1179817).
These **post-install** three ACEs are intentional; the interrupted-install
recovery guard only accepts **two** ACEs before the service exists.

The unprivileged Remote Desktop Commander could not independently open the
protected EXE; the Owner's elevated hash/ACL output is an **unsigned OS
measurement**, NOT an externally signed independent attestation.

A prior unprivileged verification child PowerShell (PID 13248, confirmed
exact command line and original Desktop Commander parent) remained alive,
consuming ~7.3 GB private memory. That **one identified orphan diagnostic**
was stopped; free RAM improved from 816 MB to 4,636 MB immediately.
Docker, Broker and databases were not stopped or changed. The previously
failing `Inspect-StagingBackupBrokerZeroDbImpact.ps1` was subsequently
re-run **read-only** and passed (`preflight_pass=true`, `blockers=[]`,
`database_mutated=false`). Use bounded process-output capture and avoid
unbounded JSON/host-inspection pipes when collecting diagnostics. The
Windows CIM FreeVirtualMemorySize field alone is insufficient for commit
headroom; review committed bytes against commit limit as well.

## New elevated read-only OS evidence collection (separate source gate)

After an approved merge and new exact-Staging deployment, invoke:

```powershell
$repo = 'M:\Users\Nagy\Repo\multi-business-multi-role-growth-intelligence-os'
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "$repo\autopilot-portable-staging\Inspect-StagingBackupBrokerOsEvidence.ps1" `
  -RepositoryPath $repo `
  -ExpectedCommit '<exact currently certified main/Staging SHA>' `
  -ExpectedBinarySha256 '<independently measured installed EXE SHA-256>'
```

Run under a genuine Windows Administrator token; ordinary remote connector
sessions will fail closed without elevation. The script checks exact certified
Staging source, Windows service configuration, live process image path, installed
SHA256, no reparse points, virtual service identity/SID type, protected
directory ACL with exactly three allowed principals and the installed EXE ACL.
It performs no OS mutation, networking, SQL or backup/restore.

A passing output means only `os_evidence_checks_passed=true`,
`independently_signed=false`, `externally_custodied=false`,
`operational_broker_certified=false` and `db_admin_authorized=false`.
It does **not** clear the independent OS attestation requirement in the
fail-closed Trust Readiness assessor. Clearing that gate would require a
separately provisioned, independently verifiable signing identity, trusted
public-key pin, freshness binding and immutable external audit receipt, as
well as the other DBA/backup one-shot prerequisites. Do not replace those
controls with a manually supplied JSON boolean or silently self-sign evidence.


## Offline Ed25519 verification bridge (source-only, trust still blocked)

The new local-connector/staging-backup-broker-signed-os-evidence.mjs
implements an offline, pure cryptographic verifier with **no key generation,
no OS/DB reads, no network, no credential storage and no operational
authority**. Its input is a detached Ed25519 signature over a *canonical
JSON payload* with fixed domain separation
(MAD4B/STAGING/BROKER/OS-EVIDENCE/V1 plus newline), together with
caller-supplied public-key SPKI DER and SHA-256 fingerprint.

The signed payload must bind a 256-bit challenge nonce, fixed verifier
audience, exact certified Staging Git SHA and measured installed
Windows service EXE SHA-256. It must include the positive local OS evidence
contract with exact device, manual-start SCM service, virtual account, SID
type, running PID, protected directory and file ACL assertions, bounded UTC
timestamp and explicit false values for DBA / backup / restore / Production
authority flags. Canonical byte comparison rejects ambiguous JSON.

The verifyStagingBrokerSignedOsEvidence() function accepts a signature
envelope, the trusted caller's expected SHA/EXE digest/challenge nonce,
a public-key SPKI pin, and a verified clock timestamp. It verifies Ed25519,
key type and fingerprint, nonce, payload binding and freshness.

**Its cryptographically valid result is never operational authorization.**
It may report cryptographic_signature_valid=true and
os_evidence_bindings_valid=true, but always
trusted_key_custody_verified=false,
immutable_external_audit_verified=false,
replay_registry_verified=false,
independently_attested=false,
broker_operationally_certified=false and db_admin_authorized=false.

An attacker can supply an arbitrary Ed25519 public key and a valid signature
created with its own private key. That proves mathematical consistency only,
not independent key custody or owner authorization. Likewise, a caller-
supplied challenge nonce does not establish durable issuance or replay
prevention. The verifier does NOT clear the protected independent OS
attestation trust gate.

CI security tests use ephemeral Ed25519 keys held **in memory only**.
Real governed trust separately requires an independently controlled public
key pin and rotation, challenge issuance and durable one-shot nonce
consumption, external immutable audit receipt verified independently,
signing-key custody outside the Broker host, and explicit one-shot Owner
authority before any DB action. The current change intentionally does not
create those authorities, store private material, connect to MariaDB,
execute Backup/Restore or mutate Production.


## Separate signed witness receipt — cryptographic bridge, no trust promotion

The source-only file local-connector/staging-backup-broker-witness-receipt.mjs
accepts the existing Ed25519-signed read-only OS evidence and a second,
separately signed and domain-separated witness receipt. The witness payload
is constrained to Staging read-only OS evidence, requiring:
- exact certified Staging Git SHA and installed Broker executable SHA-256;
- original signed evidence bytes SHA-256, original signer SPKI SHA-256;
- the identical 256-bit challenge nonce, 256-bit receipt identifier;
- short UTC receipt freshness window, and a distinct Ed25519 witness key.

The verifier checks both signatures and rejects noncanonical bytes,
unexpected authority fields, swapped identities and key reuse. A valid
result only establishes **two mathematically consistent signatures**:
signed_os_evidence_valid=true, witness_signature_valid=true and
witness_bindings_valid=true. It **always** reports
external_custody_verified=false,
immutable_external_audit_verified=false,
replay_registry_verified=false,
owner_public_key_independently_pinned=false,
independently_attested=false,
broker_operationally_certified=false, db_admin_authorized=false,
backup_executed=false, restore_executed=false, production_mutation=false.

There is intentionally no signing key provisioning or online audit service
in this change. A self-generated witness key and signed receipt do not
constitute external immutable storage or a trusted reviewer. To advance
the live trust gate, separately authorized work must establish an external
administrator-controlled trust anchor, challenge issuance and *atomic durable*
nonce consumption, and an externally independently verified append-only
audit receipt, with procedures for rotation and compromise. No caller-
provided JSON can clear the existing trust gate. The test creates two
ephemeral Ed25519 keypairs solely in CI memory and includes 21 negative
integrity and privilege-spoofing cases, without contacting MariaDB.


## Protected key readback + atomic challenge ledger (source-only feature)

Two Staging-only modules extend the cryptographic evidence chain:

1. local-connector/staging-backup-broker-challenge-ledger.mjs:
   Cryptographically random 256-bit nonce with exact certified Staging
   release SHA, Broker EXE SHA256 and <=10-minute lifetime. The private
   ledger directory MUST already exist under operator-controlled protected
   DACL (or POSIX 0700). The module does not create directories or change
   permissions. It revalidates path/ACL before every operation. Issue and
   consume markers use exclusive creation (wx) plus file fsync.
   Partial files after crashes fail closed and MUST NOT be deleted.
   Tests race eight independent OS processes (exactly one winner), then
   reboot the logical ledger object and deny the same nonce again.
   Local file-system replay denial is NOT external nonce custody or WORM.

2. local-connector/staging-backup-broker-pinned-key-registry.mjs:
   Read an ALREADY EXISTING protected trusted-key-registry.json from the
   isolated Staging host. Require matching raw-file SHA256 from an
   independently authenticated channel, protected file and directory DACL,
   strict Staging/device schema and exactly two DISTINCT Ed25519 SPKI public
   verification keys with owner and witness roles. Never generate or store
   private keys. A caller-chosen registry hash or ACL callback does NOT
   establish external approval; independent trust remains false.

Both are source-only. They are not attached to the inert Windows service,
exposed as web/connector tools, or connected to SQL. The unit tests use
isolated temporary directories and ephemeral public test keys; the tests
do NOT certify any real Windows DACL, trusted external signer, or WORM.

### Remaining external custody implementation, separate authorization

A separate independently controlled provider must actually support:
- Signing-key custody outside Broker, Owner-approved key registry and
  externally verifiable public-key rotation/pinning;
- separately controlled durable challenge issuance + atomic one-time
  consume records (not only Staging-local ledger);
- remotely verifiable append-only/WORM audit with retention protection,
  independently authenticated read-back and replay-safe receipt chain;
- independently attested DB endpoint/admin identity, secure secrets,
  explicitly signed per-operation Owner approvals and cleanup verification.

The owner/provider must select and authorize that external authority and
its access before deployment; no provider was provisioned or connected by
this change. Neither caller-provided verified=true nor a local JSON file
nor a mutable GitHub issue comment is an immutable audit proof.

Never clear operational Broker or independent trust blockers from these
source-only tests. broker_operationally_certified=false,
db_admin_authorized=false, backup_executed=false,
restore_executed=false, production_mutation=false remain mandatory.
