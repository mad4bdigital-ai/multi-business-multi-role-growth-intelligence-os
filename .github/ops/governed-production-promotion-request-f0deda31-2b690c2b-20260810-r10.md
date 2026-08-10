# Governed Production Promotion Request

- expected main: `f0deda31ef35ce0c2a9f5a5e0c28153d96d45205`
- observed Production: `2b690c2b6b244bf02fe107f08827495c341e5910`
- required source merge: PR #6856 / `21ae5beec51f6236adfa0671630bd6bd2cb63b6f`
- latest main auto-sync: #6858 / `f0deda31ef35ce0c2a9f5a5e0c28153d96d45205`
- purpose: request a governed source-pinned Production candidate from live refs
- candidate dispatch authorization: not granted by this file
- Production merge authorization: not granted by this file
- deployment / SQL / Migration 1050 / provider mutation / credential access: not authorized

The trusted launcher must re-read `main` and `Production` at execution time and fail closed on drift. Candidate construction and exact validation require the separate typed confirmation `AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST`. Any Production merge remains separately authorized against the exact resulting candidate SHA.
