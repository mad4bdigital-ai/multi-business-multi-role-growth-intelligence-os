# Runtime sheet evidence removal note

This branch removes operational use of legacy sheet evidence from governed runtime registry reads.

Runtime registry reads must use SQL-primary registry tables. Google Sheets are not valid operational fallback for runtime authority.
