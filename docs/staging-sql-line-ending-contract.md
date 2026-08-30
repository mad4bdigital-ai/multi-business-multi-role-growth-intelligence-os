# Staging SQL line-ending contract

Checksum-bound SQL migrations and seeds must declare canonical UTF-8/LF checkout bytes.

The exact `1023_sprint69_sql_cache_runtime_policy.sql` Git attribute makes Windows and Linux checkouts materialize the same reviewed bytes before checksum validation. Exact SHA256 checks remain fail-closed; alternate CRLF hashes and checksum bypasses are not accepted.

This contract does not rewrite unrelated legacy migrations and contains no semantic SQL change. Normalization does not authorize migration replay, database mutation, grant changes, or ledger reconciliation.

Local Windows/Docker Staging repair must still:

- verify the reviewed migration checksum;
- use the declared governed execution identity;
- preserve explicit-apply-only boundaries;
- perform same-cycle readback;
- fail before seed or grant mutation when verification does not match.

Production, provider, Hostinger, and Cloudflare mutation remain outside this change.
