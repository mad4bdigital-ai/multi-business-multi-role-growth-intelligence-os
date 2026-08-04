# Work Map ARM Bridge Trigger — PR 6270 R2

This one-file trigger authorizes the temporary trusted-base bridge to validate PR #6270 at exact head `9c018835333cfef9456e3c9a4c47fb5491582ab6`, consume its one-time marker, and dispatch the sole official Work Map writer.

No generated file is edited by this trigger or bridge. No protected-ref mutation, force push, provider access, deployment, credential read, SQL, Migration Apply, database mutation, external business send, or secret inclusion is authorized.
