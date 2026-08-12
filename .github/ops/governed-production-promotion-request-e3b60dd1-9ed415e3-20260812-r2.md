# Governed Production Synchronization Request

## Exact source pins

| Reference | SHA |
|---|---|
| `main` | `e2756ba3f00d6b363c2d123c9d5cadd490d28d1a` |
| `Production` | `9ed415e324d8d5187b2c29bdf16aaf77187f0333` |

This request records an explicit request to prepare a fresh, source-pinned governed promotion candidate. The candidate must have the exact `main` tree, retain both `main` and `Production` ancestry, and re-read both protected refs immediately before dispatch.

## Authorization boundary

This request authorizes only the governed request and candidate-validation path. It does **not** itself merge into `Production`, deploy runtime code, apply SQL or migrations, invoke a provider, read credentials, restart services, mutate Cloudflare, or perform any external send. A separate exact-candidate validation, `Production` freshness readback, and an explicit merge decision remain required before the release PR may change the protected `Production` ref.

> The request must fail closed if the exact request head, `main`, or `Production` moves before the trusted dispatcher revalidates its pins.
