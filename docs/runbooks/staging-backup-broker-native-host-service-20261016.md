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
