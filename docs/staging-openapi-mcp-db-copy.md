# Staging OpenAPI, MCP, and Database Copy Contract

## الهدف

تضيف هذه الدفعة مساراً مستقلاً لبيئة Staging على `dev.mad4b.com` و`mcp-dev.mad4b.com`. لا يعاد استخدام Production OAuth resources أو MCP resource أو أسرار Hostinger. يبقى `activation-dev.mad4b.com` محجوباً إلى أن يوجد Activation Gateway bundle مستقل ومختبر.

| السطح | Staging | Production | الحالة |
|---|---|---|---|
| Custom GPT/OpenAPI core | `https://dev.mad4b.com` | `https://auth.mad4b.com` | opt-in بعد إنشاء client مستقل |
| Remote MCP | `https://mcp-dev.mad4b.com` | `https://mcp.mad4b.com` | opt-in عبر OAuth فقط |
| Activation GPT | محجوب | `https://activation.mad4b.com` | لا يوجد staging bundle بعد |
| OAuth authority | `https://dev.mad4b.com` | `https://auth.mad4b.com` | resource/client منفصلان |

## Custom GPT/OpenAPI

يجب أن يكون artifact Staging معنونا بمضيف `dev.mad4b.com` ويستخدم `TENANT_GPT_STAGING_OAUTH_CLIENT_ID` و`TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET`. لا يجوز له إعلان `auth.mad4b.com` أو `activation.mad4b.com` كـserver أو authorization resource. يجب أن تعيد عملية generation fingerprint المصدر والregistry وأن تظل `secrets_included=false`.

يظل `TENANT_GPT_STAGING_ENABLED=false` في القالب إلى أن يسجل operator client مستقل في بيئة Staging ويثبت callback/resource policy. تشغيل artifact دون client مستقل يفشل بدلاً من الرجوع إلى Production client.

## Staging Remote MCP

يستخدم MCP Staging `REMOTE_MCP_ENVIRONMENT=staging` و`REMOTE_MCP_ENABLED=true` و`REMOTE_MCP_OAUTH_ENABLED=true` مع resource `https://mcp-dev.mad4b.com` وauthorization server `https://dev.mad4b.com/auth/mcp`. يظل DCR مغلقاً افتراضياً، ولا يسمح loopback إلا في اختبار محلي صريح. لا يتم منح write scope لمجرد تفعيل MCP؛ shared mutation governance وapproval وcapability وlease تبقى شروطاً مستقلة، وتبقى كل المسارات غير المربوطة fail-closed.

يقوم Cloudflare Tunnel بتوجيه `dev.mad4b.com` و`mcp-dev.mad4b.com` إلى `http://app:8080` فقط بعد إنشاء ingress يدوي مطابق لهذه السياسة. لا ينشئ Auto Pilot DNS أو Tunnel أو OAuth client. يجب أن يحتوي tunnel configuration على deny fallback، وألا يحتوي أي ingress لـ`activation-dev.mad4b.com`.

## قواعد البيانات وSchemas/Tables

النسخة المحمولة لا تسحب Production مباشرة. مسار النسخ يقبل ثلاثة ملفات محلية مضغوطة ومراجعة: `runtime.schema.sql.gz` و`governance.schema.sql.gz` و`persistence.schema.sql.gz`. يقوم `Clone-StagingDatabases.ps1` بتطبيق schema-only على الحاويات الثلاث بعد dry-run ومراجعة الخطة. مسار `sanitized_data` منفصل، ويتطلب `-AllowSanitizedData` و`STAGING_DB_COPY_APPROVED=true` وملفات تحمل لاحقة `.sanitized.sql.gz`.

> لا يجوز إدخال Production credentials أو OAuth refresh tokens أو API keys أو user-private exports إلى Staging dumps. أي نسخة بيانات يجب أن تكون sanitized ومشفرة خارج المستودع، مع manifest وSHA-256 واختبار restore مستقل.

تستخدم النسخة قواعد البيانات الثلاث كما يلي:

| DB | Container | Database/user namespace | الافتراضي |
|---|---|---|---|
| Runtime | `runtime-db` | `DB_NAME` / `DB_USER` | schema-only |
| Governance | `governance-db` | `GOVERNANCE_DB_NAME` / `GOVERNANCE_DB_USER` | schema-only |
| Persistence | `persistence-db` | `RUNTIME_PERSISTENCE_DB_NAME` / `RUNTIME_PERSISTENCE_DB_USER` | schema-only |

لا تستخدم هذه الدفعة migration على Production، ولا تعتبر النسخة الرسمية backup حتى تسجل policy وchecksum وrestore test حسب `docs/backup-and-copy-governance.md`.

## خطوات التفعيل الخارجي

على Cloudflare، ينشئ operator tunnel مخصصاً لـStaging فقط مع hostname rules لـ`dev.mad4b.com` و`mcp-dev.mad4b.com`، ثم يضع token في `.env.staging` المحلي دون commit. على OAuth، ينشئ operator clientين منفصلين إذا لزم الأمر: Custom GPT Staging client وMCP Staging client، مع callback/resource allowlists خاصة بـStaging. لا يجوز نسخ client secret من Production.

بعد ذلك يشغل operator Auto Pilot مع tunnel opt-in، ثم يراجع OpenAPI protected-resource metadata وMCP metadata من المضيفين، ثم يجري read-only canary. يظل write governance محجوباً حتى وجود approval وcapability وlease وreadback evidence.

## حدود هذه الدفعة

لا تملك بيئة العمل الحالية أسرار Hostinger أو Cloudflare أو ملفات dump تشغيلية، ولذلك لا تُنفذ هذه الدفعة اتصالاً بـProduction ولا نسخاً فعلياً من Hostinger. التغيير يضيف العقد والأدوات المحلية الآمنة؛ أما live DNS/Tunnel/OAuth client provisioning وdata export من Production فتحتاج موافقة وتنفيذاً خارجياً منفصلاً.
