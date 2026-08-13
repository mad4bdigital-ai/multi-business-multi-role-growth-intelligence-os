# تفعيل قاعدة الاستمرارية الثالثة لـ Runtime Persistence

## الغرض

هذا الدليل يعالج فجوة `durable response persistence` بعد اعتماد قاعدة بيانات ثالثة مستقلة. لا ينشئ هذا الملف قاعدة بيانات، ولا ينفذ `GRANT` أو migration أو restart، ولا يحتوي على كلمات مرور أو أسرار. التنفيذ الفعلي يظل عملية Production منفصلة تتطلب اعتمادًا صريحًا وقراءة readback في نفس الدورة.

## البنية المعتمدة

يظل فصل الصلاحيات الحالي كما هو:

| المسار | قاعدة البيانات | الهوية | الوظيفة |
|---|---|---|---|
| Runtime data | قاعدة `growthOS` الحالية | `DB_USER` | workspace وapps وconnections وruntime config وعمليات التطبيق العادية |
| Governance authority | قاعدة `growthOS_auth` الحالية | `GOVERNANCE_DB_USER` | `platform_resource_authority_bindings` وسجلات control-plane |
| Durable response persistence | قاعدة ثالثة جديدة، مثل `growthOS_persistence` | `RUNTIME_PERSISTENCE_DB_USER` | جدول `governed_tool_response_chunks` فقط |

قاعدة persistence الثالثة ليست نسخة من قاعدة التطبيق. في بيئة جديدة يمكن أن تبدأ بجدول `governed_tool_response_chunks` فقط، وتُطبق عليها migration `1048_transport_response_chunk_schema_recovery.sql`.

## إنشاء القاعدة والمستخدم

من واجهة الاستضافة التي تنشئ Database وDatabase User كوحدة واحدة، يُنشأ اسم مستقل لا يخلط بين قاعدة التطبيق وقاعدة governance. ينبغي اختيار اسم واضح مثل `growthOS_persistence`، مع مراعاة prefix الذي تفرضه الاستضافة. يُنشأ مستخدم مستقل مثل `growthOS_persist`، وتُحفظ كلمة المرور في secret manager فقط.

لا تُرسل كلمة المرور في المحادثة، ولا تُحفظ في Git، ولا تُطبع في logs أو artifacts. يجب تسجيل اسم القاعدة واسم المستخدم كـmetadata غير سري فقط، مع إخفاء القيمة الكاملة إذا احتوى مزود الاستضافة على prefix أو hostname خاص.

## migration المطلوبة

للقاعدة الثالثة الجديدة، المسار الموصى به هو migration transport-only التالية:

```text
http-generic-api/migrations/1048_transport_response_chunk_schema_recovery.sql
```

هذه migration تنشئ أو تستكمل جدول `governed_tool_response_chunks`، وتضيف الأعمدة الستة عشر المطلوبة حاليًا، وفهارس expiry والملكية، وreadiness view التالية:

```text
v_governed_response_chunk_transport_schema_readiness
```

يجب تشغيلها فقط عبر governed migration runner بالتسلسل الآتي:

1. قراءة حالة Production واسم قاعدة persistence دون إظهار credentials.
2. حساب checksum وعدد statements من الملف المدمج والتحقق من migration preflight.
3. تنفيذ dry-run فقط والتأكد من عدم وجود destructive findings.
4. تسجيل authorization منفصل مربوط بالـchecksum والـmerge SHA.
5. تطبيق migration مرة واحدة بتأكيد typed confirmation المطابق للملف.
6. قراءة readiness view في نفس الدورة والتأكد من `readiness_status = ready`.

لا تُطبق `1047` أو `20260728_governed_response_chunk_ownership.sql` بدلًا من `1048` على قاعدة جديدة؛ فهما مساران أقدم أو أوسع. لا تُطبق migration على قاعدة `growthOS_auth`.

## أقل صلاحيات runtime persistence

بعد اكتمال schema، يحتاج المستخدم `RUNTIME_PERSISTENCE_DB_USER` إلى الصلاحيات الجدولية التالية فقط:

| الجدول | العمليات |
|---|---|
| `governed_tool_response_chunks` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |

لا تُمنح هوية runtime persistence صلاحيات `CREATE`, `ALTER`, `DROP`, `INDEX`, `TRIGGER`, `REFERENCES`, أو `GRANT OPTION`. ولا تُمنح صلاحيات schema-wide أو global write. يجب أن يفشل التطبيق مغلقًا إذا ظهرت صلاحيات واسعة أو roles غير محددة.

صيغة grant الإرشادية يجب توليدها على بيئة الإدارة بعد تثبيت اسم القاعدة وhost الفعليين، ولا تُنفذ حرفيًا مع placeholders:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE
ON `<PERSISTENCE_DATABASE>`.`governed_tool_response_chunks`
TO '<RUNTIME_PERSISTENCE_USER>'@'<RUNTIME_PERSISTENCE_HOST>';
```

تُجرى عملية `GRANT` من هوية DBA أو migration/admin منفصلة، وليس من مستخدم التطبيق. يجب إجراء privilege readback للتحقق من العمليات الأربع وغياب global/schema grants وغياب grant option.

## إعداد Production secrets

بعد نجاح schema وprivilege readback فقط، تُضبط المتغيرات التالية في secret manager أو إعدادات runtime:

```text
RUNTIME_PERSISTENCE_DB_HOST=<same managed database host>
RUNTIME_PERSISTENCE_DB_PORT=3306
RUNTIME_PERSISTENCE_DB_NAME=<third persistence database>
RUNTIME_PERSISTENCE_DB_USER=<restricted persistence user>
RUNTIME_PERSISTENCE_DB_PASSWORD=<secret, never committed or printed>
```

لا يستخدم التطبيق `DB_USER` كـfallback لمسار durable chunks. غياب أي متغير من هذه المجموعة يجب أن يبقي السلوك الحالي الآمن: لا يُعاد `chunk_id` من دون persistence durable، ويظهر `response_chunk_persistence_unavailable` بصورة منظمة.

## معالجة write authority في قاعدة Runtime

هذه الخطوة منفصلة عن قاعدة persistence الثالثة. سجل Production أظهر أن جدولَي `dynamic_audit_scheduler_runs` و`actions` موجودان، لكن الكتابة مرفوضة. يجب أولًا تنفيذ readiness readback لهوية `DB_USER` الفعلية، ثم منح الحد الأدنى للوظائف المطلوبة فقط.

| الوظيفة | الجداول المرشحة للحد الأدنى |
|---|---|
| OpenAPI inventory sync | `actions`, `endpoints`, `openapi_endpoint_inventory_sync_runs`، مع العمليات التي يثبتها static inventory وreadback |
| Dynamic audit scheduler | `dynamic_audit_scheduler_runs`، ومع تفعيل checkpoint rollups: `platform_evolution_checkpoints` و`checkpoint_auto_rollups` |

لا يُمنح `DB_USER` صلاحية على قاعدة governance لحل هذه المشكلة، ولا تُستخدم `GRANT ALL`. يجب أن يثبت readback كل عملية مطلوبة وغياب الصلاحيات الواسعة، ثم تُشغل اختبارات OpenAPI وdynamic audit بصورة محدودة.

## تحقق ما بعد التفعيل

يُعد التفعيل ناجحًا فقط عند تحقق الشروط التالية دون أسرار:

- readiness view للـtransport schema تعيد `ready` وعدد الأعمدة `16`.
- privilege readback يعيد العمليات الأربع على جدول chunks فقط.
- `RUNTIME_PERSISTENCE_DB_*` مكتملة في runtime، دون طباعة القيم.
- durable recovery smoke ينجح بتأكيد `RUN_RESPONSE_CHUNK_DURABLE_RECOVERY_SMOKE`.
- بعد إخلاء hot cache، تُقرأ الصفحات من `governed_tool_response_chunk_store` وتنجح SHA-256 وUTF-8 byte length وTTL extension.
- dynamic audit يسجل start/finish دون `write_authority_unavailable`.
- OpenAPI inventory sync يسجل `status=ready` أو `status=success` دون `openapi_inventory_write_authority_unavailable`.
- لا توجد migrations أو grants أو provider mutations غير موثقة في evidence.

## التراجع

إذا فشل runtime بعد إعداد secrets، يُزال إعداد `RUNTIME_PERSISTENCE_DB_*` من runtime أو يُعاد الإصدار السابق دون حذف قاعدة persistence أو جدول chunks. لا تُنفذ `DROP TABLE` أثناء rollback. تبقى البيانات القديمة غير مستخدمة إلى أن تتم مراجعتها عبر مسار retention مستقل.

## حدود هذا الدليل

هذا الدليل لا يثبت readiness Production من تلقاء نفسه، ولا يمنح التفويض لتشغيل migration أو تعديل grants. كل من migration apply وdatabase grant وsecret write وrestart عمليات مستقلة، ويجب أن يكون لكل منها اعتماد وreadback خاص به. `secrets_included=false` هو شرط دائم لكل evidence الناتج من هذه العملية.

<!-- contract: runtime-persistence-third-database-activation.v1 -->
<!-- excluded paths: feat/spec015-tenant-audit-convergence -->
<!-- provider_calls=0; credential_payload_reads=0; external_writes=0; secrets_included=false -->
