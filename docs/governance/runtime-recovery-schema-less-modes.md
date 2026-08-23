# مسارا runtime recovery عند غياب schema أو tables

## الغرض

يوفر هذا المستودع مسارين لتشخيص وتشغيل السطح read-only عندما تكون قاعدة البيانات غير مهيأة أو عندما لا تحتوي بعض البيئات على الجداول المطلوبة. كلا المسارين **لا ينشئ جلسة، ولا يكتب conversation turns، ولا يطبق migration، ولا ينفذ grants، ولا يفعّل Production**. الهدف هو إبقاء catalog وsession-context الرصديين قابلين للقراءة مع إعلان صريح بأن persistence غير متاحة، إلى أن تُجهّز قاعدة البيانات canonical.

> لا يمكن لمتغير GitHub أن يحل محل مخزن persistent. وضع snapshot يحل مشكلة **schema-less read-only availability and evidence** فقط؛ أما الجلسات الدائمة، أرشفة turns، hard activation، وعمليات الكتابة فتظل محجوبة حتى تتوفر schema وleast-privilege grants المناسبة.

## المسار الأساسي: GitHub snapshot

في GitHub، افتح **Settings → Environments → Production → Environment variables** وأضف المتغيرات غير السرية التالية. لا تضع كلمات مرور أو tokens أو بيانات محادثات شخصية أو request payloads داخلها.

| المتغير | القيمة | الوظيفة |
|---|---|---|
| `RUNTIME_RECOVERY_SOURCE_MODE` | `github_snapshot` | يفعّل المصدر المتغيري read-only |
| `RUNTIME_RECOVERY_CATALOG_JSON` | JSON يحوي `tools` غير فارغة | catalog descriptors المسموح عرضها |
| `RUNTIME_RECOVERY_SESSION_CONTEXT_JSON` | JSON يحوي `subject` اختياريًا | سياق read-only بدون `session_id` |
| `RUNTIME_RECOVERY_SNAPSHOT_JSON` | اختياري؛ JSON موحد | بديل عن المتغيرين السابقين |

يقوم loader بفرض حد أقصى **48 KiB لكل payload**، ويفرض وجود tool واحدة على الأقل، ويرفض الحقول الحساسة، و`session_id` الدائم، و`runtime_authority`, `persistent`, `durable`, وأي إعلان mutation. عند تفعيل هذا المصدر:

- يعيد `GET /gpt/tools` catalog snapshot مع `source=runtime_recovery_snapshot`.
- يعيد `GET /activation/session-context/read-only` عقدًا ثابتًا يحمل `activation_layer=session_context`, `read_only=true`, و`session_id=null`.
- يعرض `persistence=unavailable`, `database_connection_performed=false`, و`runtime_authority=false`.
- يسمح فقط بأداة `runtime_recovery_status_read_only` الافتراضية الموجودة في snapshot؛ أي dispatch آخر، بما فيه grant أو migration أو session write، يُرفض fail-closed.
- يتجاوز chunking وsession archive في هذا الوضع حتى لا يؤدي fallback الرصدي نفسه إلى محاولة الكتابة في `gpt_session_turns` أو `json_assets`.

## المسار البديل: repository snapshot

إذا تعذر استخدام GitHub Variables أو كان المطلوب fallback ثابتًا قابلًا للمراجعة، استخدم:

| المتغير | القيمة |
|---|---|
| `RUNTIME_RECOVERY_SOURCE_MODE` | `repository_snapshot` |
| `RUNTIME_RECOVERY_SNAPSHOT_PATH` | `http-generic-api/config/runtime-recovery-repository-snapshot.json` |

هذا المسار لا يعتمد على DB ولا على GitHub API ولا على secrets. الملف committed ومراجعته جزء من PR، ويظل read-only وغير persistent. يجب تعديل محتواه عبر PR ومراجعة المالك؛ لا تُستخدم متغيرات runtime لتجاوز الحاجز أو لإضافة tool ذات write semantics.

## تشغيل Workflow من GitHub

شغّل Workflow `Production Runtime Recovery` بـ`workflow_dispatch` كما يلي:

| الحقل | المسار الأساسي | المسار البديل |
|---|---|---|
| `strategy` | `snapshot` | `snapshot` |
| `source_mode` | `github_snapshot` | `repository_snapshot` |
| `expected_production_sha` | الرأس exact للفرع المصدر | الرأس exact للفرع المصدر |
| `apply_execution` | `false` | `false` |
| `confirmation` | فارغ | فارغ |

الـWorkflow يثبت الرأس exact قبل checkout وبعده، ويستخدم `vars.*` فقط للـsnapshot غير السري. لا يحتاج snapshot mode إلى `MYSQL_BOOTSTRAP_*`, `BACKEND_API_KEY`, أو `PRODUCTION_DEPLOY_*`، ولا يستدعي migration/grant/deploy/restart. إذا أُرسل `source_mode=sql` مع `strategy=snapshot` أو `apply_execution=true`، يفشل الحاجز عمدًا.

## متى نعود إلى sql؟

بعد تجهيز canonical schema وقراءة privileges وsame-cycle readback، أعد `RUNTIME_RECOVERY_SOURCE_MODE=sql` واحذف snapshot variables أو اتركها غير مستخدمة. لا تعتبر snapshot دليلًا على أن `customer_sessions`, `gpt_session_turns`, أو `mcp_catalog_level` موجودة؛ إثبات ذلك يتطلب مسار SQL read-only canonical ثم تفويضًا منفصلًا لأي migration أو grant أو activation.
