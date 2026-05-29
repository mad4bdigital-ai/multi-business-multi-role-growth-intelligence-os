# Runtime sheet evidence removal note

This branch removes operational use of legacy sheet evidence from governed runtime registry reads.

Runtime registry reads must use SQL-primary registry tables. Google Sheets are not valid operational fallback for runtime authority.

This PR also carries same-content mainline test/source parity files when needed only to keep the conflict-resolution branch aligned with the current `main` test script; the functional scope remains sheet runtime evidence removal.

WordPress auth/publish files copied from `main` are parity-only conflict-resolution content and are not part of the sheet runtime fallback removal behavior.
