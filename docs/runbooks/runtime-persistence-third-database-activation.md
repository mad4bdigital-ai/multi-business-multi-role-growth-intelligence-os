# تفعيل قاعدة الاستمرارية الثالثة لـ Runtime Persistence

## الغرض

هذا الدليل يعالج فجوة `durable response persistence` بعد اعتماد قاعدة بيانات ثالثة مستقلة. لا ينشئ هذا الملف قاعدة بيانات، ولا ينفذ `GRANT` أو migration أو restart، ولا يحتوي على كلمات مرور أو أسرار. التنفيذ الفعلي يظل عملية Production منفصلة تتطلب اعتمادًا صريحًا وقراءة readback في نفس الدورة.

## البنية المعتمدة

يظل فصل الصلاحيات الحالي كما هو:

| المسار | قاعدة البيانات | الهوية | الوظيفة |
|---|---|---|---|
| Runtime data | قاعدة `growthOS` الحالية | `DB_USER` | workspace وapps وconnections وruntime config وعمليات التطبيق العادية |
| Governance authority | `u338416126_growthOS_auth` | `GOVERNANCE_DB_USER` | control-plane authority وmigration/readback registries |
| Durable response persistence | `u338416126_growthOS_persi` | `RUNTIME_PERSISTENCE_DB_USER` | جدول `governed_tool_response_chunks` فقط |

قاعدة persistence الثالثة ليست نسخة من قاعدة التطبيق. في بيئة جديدة يمكن أن تبدأ بجدول `governed_tool_response_chunks` فقط، وتُطبق عليها migration `1048_transport_response_chunk_schema_recovery.sql`. أما قاعدة `u338416126_growthOS_auth` فلا تُعامل كقاعدة runtime ثانية؛ فهي control-plane منفصلة وتحتاج foundation/readback الخاصين بالـGovernance قبل اعتماد `platform_resource_authority_bindings`.

## سياسة charset وcollation الإلزامية

قبل أي DDL أو migration على أي من القاعدتين، يجب إجراء readback لـ`information_schema.SCHEMATA` و`information_schema.TABLES` و`information_schema.COLUMNS`، ثم مقارنة النتيجة مع سياسة المستودع: `utf8mb4` كـcharacter set افتراضي، و`utf8mb4_unicode_ci` كـcollation موحد للنصوص والمفاتيح. يسمح `utf8mb4_bin` فقط لأعمدة JSON-like عندما يكون ذلك مبررًا ومسجلًا؛ لا يُسمح بتصحيح mismatch تلقائيًا.

يجب أن تكون migration الجديدة معلنة صراحةً بـ`DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`، وأن تستخدم جداول `InnoDB`. يُعد أي mismatch في database default أو table collation أو عمود relational key **حاجزًا blocking**. لا يُنشأ exception إلا عبر سجل governed مستقل مع سبب وانتهاء محدد؛ لا تُستخدم exceptions لتجاوز قاعدة جديدة فارغة.

إذا كانت القاعدة تحتوي على policy registry، يجب أن يثبت readback أن `v_database_collation_policy_status` يعيد `actionable_violation_count=0`. وإذا كانت القاعدة فارغة ولا تحتوي registry، فحالة preflight هي `blocked: collation_policy_registry_missing` إلى أن يتم اعتماد bootstrap foundation المناسب؛ لا يُفترض أن واجهة Hostinger اختارت collation الصحيح من الاسم وحده.

## إنشاء القاعدة والمستخدم

من واجهة الاستضافة التي تنشئ Database وDatabase User كوحدة واحدة، يُنشأ اسم مستقل لا يخلط بين قاعدة التطبيق وقاعدة governance. ينبغي اختيار اسم واضح مثل `growthOS_persistence`، مع مراعاة prefix الذي تفرضه الاستضافة. يُنشأ مستخدم مستقل مثل `growthOS_persist`، وتُحفظ كلمة المرور في secret manager فقط.

لا تُرسل كلمة المرور في المحادثة، ولا تُحفظ في Git، ولا تُطبع في logs أو artifacts. يجب تسجيل اسم القاعدة واسم المستخدم كـmetadata غير سري فقط، مع إخفاء القيمة الكاملة إذا احتوى مزود الاستضافة على prefix أو hostname خاص.

## تحضير قاعدة Governance الجديدة

قاعدة `u338416126_growthOS_auth` تحتاج مسارًا مستقلًا عن migration 1048. migration `950_sprint68_platform_resource_authority_bindings.sql` هي migration الهدف لجدول authority، لكنها ليست bootstrap مكتفية ذاتيًا على قاعدة فارغة؛ فهي تكتب إلى `execution_policies`. كذلك يتطلب عقد privilege readiness وجود الجداول التالية في قاعدة Governance: `capability_resolution_envelope_ledger`, `approval_holds`, `governed_migration_authorization_registry`, `capability_apply_authorization_policy_registry`, `runtime_dispatch_certification_registry`, `governed_migration_ledger`, و`platform_resource_authority_bindings`.

لذلك يكون التسلسل الآمن للـGovernance كما يلي: أولًا تحديد bootstrap foundation المعتمد للقاعدة الجديدة وقراءة وجود هذه الجداول، ثم تشغيل collation preflight، ثم dry-run للمigrations المؤسسة بترتيبها، ثم authorization بالـchecksum، ثم migration `950`، ثم privilege readback على `GOVERNANCE_DB_USER`. لا يجوز تشغيل `950` منفردة على قاعدة فارغة، ولا يجوز نسخ `schema.sql` كاملًا إلى قاعدة authority دون قرار معماري موثق؛ إذا لم توجد حزمة bootstrap minimal معتمدة، تبقى الحالة `blocked` ويُفتح PR منفصل لها بدل التخمين.

## migration المطلوبة لقاعدة Persistence

لقاعدة `u338416126_growthOS_persi`، المسار الموصى به هو migration transport-only التالية:

```text
http-generic-api/migrations/1048_transport_response_chunk_schema_recovery.sql
```

هذه migration تنشئ أو تستكمل جدول `governed_tool_response_chunks`، وتضيف الأعمدة الستة عشر المطلوبة حاليًا، وفهارس expiry والملكية، وreadiness view التالية:

```text
v_governed_response_chunk_transport_schema_readiness
```

يجب تشغيلها فقط عبر governed migration runner/target-aware migration path بالتسلسل الآتي:

1. قراءة حالة Production واسم قاعدة persistence دون إظهار credentials.
2. قراءة charset/collation وengine للقاعدة الهدف، ثم إثبات أن سياسة `utf8mb4/utf8mb4_unicode_ci` مستوفاة.
3. حساب checksum وعدد statements من الملف المدمج والتحقق من migration preflight.
4. تنفيذ dry-run فقط والتأكد من عدم وجود destructive findings.
5. تسجيل authorization منفصل مربوط بالـchecksum والـmerge SHA في control-plane، لا في قاعدة persistence باستخدام fallback غير مقيد.
6. تطبيق migration مرة واحدة بتأكيد typed confirmation المطابق للملف عبر مسار target-aware؛ لا يُستخدم `apply-single-migration` القديم لتجاوز الحوكمة.
7. قراءة readiness view وschema/collation readback في نفس الدورة والتأكد من `readiness_status = ready`.

لا تُطبق `1047` أو `20260728_governed_response_chunk_ownership.sql` بدلًا من `1048` على قاعدة جديدة؛ فهما مساران أقدم أو أوسع. لا تُطبق `1048` على `u338416126_growthOS_auth`، ولا تُطبق `950` على `u338416126_growthOS_persi`.

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

- قاعدة Governance تقرأ قاعدة البيانات الصحيحة، وتحتوي foundation الجداول السبعة المطلوبة قبل privilege readback، و`platform_resource_authority_bindings` بعد migration 950.
- readiness view للـtransport schema تعيد `ready` وعدد الأعمدة `16`.
- قاعدة Persistence و`governed_tool_response_chunks` تستخدم `utf8mb4` و`utf8mb4_unicode_ci` و`InnoDB`، ولا توجد actionable collation violations.
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

<!-- contract: runtime-persistence-third-database-activation.v2 -->
<!-- governance_database: u338416126_growthOS_auth -->
<!-- persistence_database: u338416126_growthOS_persi -->
<!-- collation_policy: utf8mb4/utf8mb4_unicode_ci; json_exception=utf8mb4_bin -->
<!-- excluded paths: feat/spec015-tenant-audit-convergence -->
<!-- provider_calls=0; credential_payload_reads=0; external_writes=0; secrets_included=false -->
