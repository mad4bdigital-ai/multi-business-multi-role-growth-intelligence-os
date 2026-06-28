# نظرة عامة — Spec Kit 005

## الهدف

فصل **عقد النقل الثابت** عن **قدرات MCP الديناميكية** دون فقد سلطة قاعدة البيانات.

```text
Git / OpenAPI
  └─ hosts, auth profiles, fixed routes, list/call envelopes

MySQL Registry
  └─ tools, input/output schemas, visibility, bindings, lifecycle, approvals

Activation Edge Gateway
  └─ routing and traffic controls only; no DB and no business logic

Runtime
  └─ re-resolves SQL authority for every tool call
```

## الأسطح المستهدفة

| Surface | Schema | Server |
|---|---|---|
| Admin Core | `openapi.custom-gpt.auth-dispatcher.yaml` | `https://auth.mad4b.com` |
| Activation Admin | `openapi.custom-gpt.activation-admin.yaml` | `https://activation.mad4b.com` |
| Tenant Core | `openapi.tenant-gpt.auth.yaml` | `https://auth.mad4b.com` |
| Tenant Activation | `openapi.tenant-gpt.activation.yaml` | `https://activation.mad4b.com` |
| Local Device | `openapi.gpt-action.local-connector.yaml` | `https://connector.mad4b.com` |
| Development | `openapi.gpt-action.dev-dispatcher.yaml` | `https://dev.mad4b.com` |

## قاعدة السلطة

- ثابت في Git: topology، server URLs، security schemes، fixed operations، envelopes، generation rules.
- ديناميكي في SQL: tool schemas، surface bindings، permissions، lifecycle، credential/readback policies.
- لا يستعلم الـEdge Gateway من MySQL مباشرة.
- لا يقبل runtime endpoint أو provider URL من العميل.
- لا تعتبر أداة قابلة للتنفيذ لمجرد ظهورها في `listTools`.
