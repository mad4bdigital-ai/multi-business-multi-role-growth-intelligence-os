# Multi-Surface Agent Runtime

The platform treats Hermes, OpenClaude, and OpenClaw as complementary replaceable surfaces behind MAD4B tenant authority.

- Hermes: Local Desktop workspace and personal assistant surface.
- OpenClaude: coding and repository agent.
- OpenClaw: WhatsApp, Telegram, Discord, Slack, Signal, and multi-agent channel gateway.

Each tenant selects `platform_managed` or `dedicated_managed` independently per surface. Platform-managed uses a registered platform runtime and server-side credentials. Dedicated-managed binds a tenant-owned Local Connector device or remote runtime target. No automatic cross-mode fallback is allowed.

Each authenticated user owns only their own preferences. The API never accepts a user override. Tenant owner/admin controls deployment mode. The complete capability catalog is visible, but enabling shell, file/repository writes, external sends, cron, browser control, skill activation, or delegation does not bypass the separate execution approval gate.

Tenant API:

- `GET /me/agent-surfaces/catalog`
- `GET /me/agent-surfaces`
- `GET /me/agent-surfaces/readiness`
- `PUT /me/agent-surfaces/{surface_key}/preferences`
- `PUT /me/agent-surfaces/{surface_key}/deployment`

Initial readiness:

- OpenClaude platform-managed resolves to `platform_openrouter_dev_agent_v1`.
- Hermes and OpenClaw platform-managed runtimes are registered as `planned` until their certified runtime containers are deployed.
- Dedicated readiness requires a tenant-scoped active and validated target.

Provider secrets remain server-side and every response declares `secrets_included=false`.
