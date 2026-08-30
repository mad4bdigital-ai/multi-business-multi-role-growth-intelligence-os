# Staging SQL line-ending contract

Repository SQL migrations and seeds are canonical UTF-8 text with LF line endings.

The `*.sql text eol=lf` Git attribute makes Windows and Linux checkouts materialize the same reviewed bytes before checksum validation. Exact SHA256 checks remain fail-closed; alternate CRLF hashes and checksum bypasses are not accepted.

The migrations normalized with this contract contain no semantic SQL change. Their tracked CRLF bytes are replaced with LF bytes only. Normalization does not authorize migration replay, database mutation, grant changes, or ledger reconciliation.

Local Windows/Docker Staging repair must still:

- verify the reviewed migration checksum;
- use the declared governed execution identity;
- preserve explicit-apply-only boundaries;
- perform same-cycle readback;
- fail before seed or grant mutation when verification does not match.

Production, provider, Hostinger, and Cloudflare mutation remain outside this change.
