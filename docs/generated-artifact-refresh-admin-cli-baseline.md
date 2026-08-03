# Frontend generated baseline refresh trigger

Current-main governed trigger for the deterministic Frontend surface baseline drift introduced when `http-generic-api/routes/adminCliRoutes.js` changed in commit `c7aa7cd8a9597e317c8bdaa17a583884d3e674c0` without refreshing `http-generic-api/frontend-surface-dispatch.generated.json`.

Expected bounded generated change:

- `http-generic-api/frontend-surface-dispatch.generated.json`

Exact read-only evidence:

- protected main at reconstruction: `cf4282d5fd74b7c20cbac3ad2aa74742d135d2a5`
- stale Blob: `cb9031fbf95ff7a6629a178ccc0401257aad04bf`
- regenerated Blob: `440562278043eb76c9e1219c2b65d29794fb86c4`
- regenerated SHA-256: `ac62f86578f825a96246a1cfbc5fa0cce2fe9d109fce6b4a808ebb0a2d5620aa`
- expected content delta: repository source digest plus the two `routes/adminCliRoutes.js` digest occurrences only

This temporary document must be removed after the governed exact-head Writer commits the accepted generated Blob. No Production/provider action, deployment, restart, database/SQL mutation, Migration Apply, credential read, external send, protected-ref mutation, or force push is authorized.