# Governed Production Promotion Request

- expected main: `974871439af3c0737fc62ea15f3c7a2a544e04b4`
- expected main tree: `b9839554873eb733ab0430b6a9a2cb2130dfc977`
- observed Production: `9ed415e324d8d5187b2c29bdf16aaf77187f0333`
- purpose: prepare a fresh governed source-pinned Production candidate after main drift invalidated candidate `aa0f6d87891f865c871f7d88edc65d0795e83fdd`
- candidate dispatch authorization: not granted by this file
- Production merge authorization: not granted by this file
- Production DB principal/GRANT/secret mutation: not authorized
- deployment / SQL / Migration 1050 / provider mutation / credential disclosure: not authorized
- DB_USER broadening / GRANT ALL / schema-wide write / credential fallback: prohibited

The trusted launcher must live-read `main`, `Production`, and this request head at execution time and fail closed on any drift. Candidate construction may only produce and validate a tree-identical current-main Production candidate. Any Production merge remains separately governed against the exact resulting candidate SHA.
