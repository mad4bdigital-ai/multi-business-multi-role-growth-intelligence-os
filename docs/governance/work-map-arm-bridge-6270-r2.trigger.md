# Work Map ARM Bridge Trigger — PR 6270 R2

Retry 2 authorizes the temporary trusted-base bridge to validate PR #6270 at exact head `9c018835333cfef9456e3c9a4c47fb5491582ab6`, consume its replacement one-time marker, and dispatch the sole official Work Map writer with an explicit repository binding.

The prior bridge Run `30917368384` failed before dispatch because `gh workflow run` lacked `--repo`; no official writer run was created and the target head did not move.

No generated file is edited by this trigger or bridge. No protected-ref mutation, force push, provider access, deployment, credential read, SQL, Migration Apply, database mutation, external business send, or secret inclusion is authorized.
