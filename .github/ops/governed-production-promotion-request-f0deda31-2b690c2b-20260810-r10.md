# Governed Production Promotion Request

- expected main: `14fc483e65d4414924519a4e5515b458535c3092`
- observed Production: `2b690c2b6b244bf02fe107f08827495c341e5910`
- required source merge: PR #6856 / `21ae5beec51f6236adfa0671630bd6bd2cb63b6f`
- latest main synchronization: Surface contract agent #6850 / `14fc483e65d4414924519a4e5515b458535c3092`
- purpose: request a governed source-pinned Production candidate from live refs
- candidate dispatch authorization: not granted by this file
- Production merge authorization: not granted by this file
- deployment / SQL / Migration 1050 / provider mutation / credential access: not authorized

The request branch was ancestry-preserving synchronized with current `main` through PR #6862 after an earlier exact authorization became stale. The trusted launcher must re-read `main` and `Production` at execution time and fail closed on drift. Candidate construction and exact validation require a fresh typed confirmation `AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST`. Any Production merge remains separately authorized against the exact resulting candidate SHA.
