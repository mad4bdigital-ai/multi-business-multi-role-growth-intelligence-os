# Hostinger Runtime Bootstrap Contract

هذا العقد يضيف مسارًا مستقلًا ومحدودًا لمعالجة قواعد runtime التي تكون ناقصة schema أو غير جاهزة للصلاحيات. وهو لا يضعف `/gpt/tools` أو `/gpt/tools/call` أو مسارات session-context؛ هذه المسارات تظل DB-backed ومحمية بطبقات authorization المعتادة.

> **قاعدة أساسية:** تشغيل `npm start` أو `prestart` أو Docker لا يطبق migrations أو grants. حالة التطبيق التشخيصية لا تعني أن bootstrap حدث، ونجاح Auto Deploy لا يساوي نجاح SQL apply.

## الأوضاع

الأمر الافتراضي هو `plan`، وهو لا يفتح اتصالًا بقاعدة البيانات. وضع `dry_run` يقرأ هوية الهدف وعدد الجداول والـschema prerequisites والـledger والـgrant evidence فقط. وضع `apply` هو المسار الوحيد الذي يمكنه تنفيذ SQL، ولا يعمل إلا بعد كل الحواجز المستقلة والتأكيد النصي المرتبط بالـSHA والهدف.

| الوضع | اتصال DB | SQL mutation | الاستخدام |
|---|---:|---:|---|
| `plan` | لا | لا | عرض العقد وعدم التنفيذ |
| `dry_run` | نعم | لا | قراءة parity وschema/ledger/grant evidence |
| `apply` | نعم | نعم، allowlist فقط | تنفيذ recovery بعد التفويض والتأكيد الدقيق |

## المتغيرات الحاكمة

يجب تمرير المتغيرات من GitHub Environment/Variables/Secrets أو من release hook محمي. لا تضع كلمات المرور في command line أو ملفات log.

| المجموعة | المتغيرات | القاعدة |
|---|---|---|
| المصدر | `BOOTSTRAP_EXPECTED_SHA`, `BOOTSTRAP_EXPECTED_BRANCH`, `BOOTSTRAP_EXPECTED_REPOSITORY` | SHA كامل بطول 40، والفرع `Production` والمستودع canonical |
| الهدف | `RUNTIME_BOOTSTRAP_TARGETS_JSON`, `BOOTSTRAP_TARGET_KEY`, `BOOTSTRAP_TARGET_DATABASE` | الهدف يجب أن يكون allowlisted مع `database_sha256` و`target_fingerprint` المطابقين |
| الحساب | `MYSQL_BOOTSTRAP_HOST`, `MYSQL_BOOTSTRAP_PORT`, `MYSQL_BOOTSTRAP_USER`, `MYSQL_BOOTSTRAP_PASSWORD`, `MYSQL_BOOTSTRAP_DATABASE` | حساب مستقل عن `DB_*`؛ لا يوجد fallback إلى runtime credentials |
| migration | `BOOTSTRAP_MIGRATION` | `20260815` فقط قابلة لـapply؛ `225` و`1048` dry-run فقط |
| التأكيد | `BOOTSTRAP_CONFIRMATION` | في apply يجب أن تساوي حرفيًا `APPLY_HOSTINGER_RUNTIME_BOOTSTRAP:<exact-sha>:<target-key>` |
| bundle | `BOOTSTRAP_SCHEMA_BUNDLE_MANIFEST` | مطلوب فقط لمسار zero-table بعد توليد bundle canonical ومثبت المصدر والـchecksum |

لا تعرض قيمة `RUNTIME_BOOTSTRAP_TARGETS_JSON` أو credentials في التقرير النهائي. يكتب البرنامج evidence محدودًا ويعلن دائمًا `secrets_included=false`.

## المسار الحالي غير المتصل بقاعدة البيانات

للمعاينة فقط:

```bash
cd http-generic-api
npm run runtime-bootstrap:plan
```

لا يطبق هذا الأمر شيئًا ولا يحتاج أي credential. أما dry-run وapply فيحتاجان injection للمتغيرات من secret manager، ثم:

```bash
cd http-generic-api
npm run runtime-bootstrap:dry-run
npm run runtime-bootstrap:apply
```

لا تُشغّل الأمر الأخير إلا بعد مراجعة نتيجة dry-run وتثبيت exact deployment SHA وقراءة target identity. لا يفترض هذا المستودع وجود Hostinger release hook فعّال؛ يجب أن تكون دعوة الأمر جزءًا من إعداد تشغيلي منفصل ومراجع.

## قواعد قاعدة البيانات

### قاعدة nonempty الحالية

إذا كان عدد الجداول أكبر من صفر، يُمنع baseline schema bundle. بالنسبة إلى الحادثة الحالية، المسار الصحيح هو قراءة prerequisites ثم تنفيذ `20260815_custom_gpt_mcp_catalog_levels.sql` فقط بعد التأكد من وجود `admin_platform_endpoint_tools` و`tenant_platform_endpoint_tools`. بعدها تُقرأ postconditions الخاصة بـ`mcp_catalog_level` وindexes وfeedback row، ثم تُقرأ/تُسجل canonical ledger evidence. صلاحيات runtime المطلوبة محصورة في `SELECT, INSERT, UPDATE` للجداول الستة التالية فقط:

`customer_sessions`, `gpt_session_turns`, `actions`, `dynamic_audit_scheduler_runs`, `execution_log`, و`json_assets`.

### قاعدة zero-table

لا يستخدم المسار `schema.sql` وحده كضمان؛ فهو baseline جزئي وليس current runtime schema كاملًا. يجب أولًا إنتاج `runtime.schema.sql.gz` من الـcanonical staging schema-bundle producer على checkout محلي disposable وبـexact source SHA، مع manifest يثبت `schema_only=true`، وعدم الوصول إلى Production/provider، وعدم تصدير البيانات، وعدم وجود secrets. بعد ذلك فقط يقبل bootstrap manifest إذا طابق SHA والـtable list والـcompressed checksum، ويطبق runtime وgovernance schema bundles ثم seed prerequisites `039_sprint43_data_integrity_and_missing_tables.sql` و`1043_sprint69_dynamic_container_hvac_activity_seed.sql`. تُنفذ `20260815_custom_gpt_mcp_catalog_levels.sql` بعدها كـincident apply candidate مرة واحدة، ثم يعيد المسار postconditions والـledger والـgrants.

إذا غاب bundle أو كان source SHA أو table count أو checksum غير مطابق، يفشل المسار قبل mutation. لا يسمح هذا العقد بتشغيل مجلد migrations كامل على قاعدة Production فارغة.

## GitHub workflow

يوفر المستودع مسارًا يدويًا داخل workflow recovery القائم `.github/workflows/production-runtime-parity-evidence.yml` عبر مدخلات `bootstrap_mode` و`bootstrap_target_key` و`bootstrap_target_database` و`bootstrap_migration` و`bootstrap_confirmation`. يبدأ `bootstrap_mode` معطّلًا؛ و`plan` لا يفتح اتصالًا بقاعدة البيانات، و`dry_run` للقراءة فقط، و`apply` مشروط بـEnvironment approval وconfirmation وallowlist مستقلة. لا يعمل هذا المسار ضمن `npm start` أو `prestart` أو Docker أو Hostinger Auto Deploy. يجب أن تظل القيم الفعلية للـtarget وcredentials في إعدادات GitHub المناسبة، مع عدم تضمينها في PR أو logs.

يجب أن يمر مسار bootstrap داخل workflow بالترتيب التالي: يثبت أن `expected_sha` هو رأس `Production`، يعمل checkout لنفس الـSHA، يشغّل contract tests، ثم ينفذ `plan` أو `dry_run` أو `apply` فقط عند اختيار `bootstrap_mode` صريح غير `disabled`. قبل `dry_run` أو `apply` ينفذ الـworkflow فحصًا GET-only محدودًا إلى `https://auth.mad4b.com/version` و`https://auth.mad4b.com/deployment-info`. يجب أن يعيد كلاهما SHA المنشور المطابقًا تمامًا لـ`expected_sha`، ويجب أن يثبت `/deployment-info` فرع `Production`. أي HTTP failure أو JSON غير صالح أو SHA فارغ أو mismatch أو فرع مختلف يوقف المسار fail-closed قبل فتح bootstrap database connection أو تنفيذ migration/grant. لا يصنف أي 502 من Hostinger أو غياب route كنجاح migration؛ direct bootstrap path لا يعتمد على `/gpt/tools/call`.

يشغّل job العقد مباشرةً `test-runtime-bootstrap-contract.mjs` و`test-runtime-gate-deployment-info-parity.mjs` و`hostinger-runtime-bootstrap.mjs --plan`، حتى لا يبقى اختبار parity مجرد ملف موثق غير منفذ. تُحفظ نتيجة parity التشغيلية في evidence محدود، مع `read_only=true` و`mutation_performed=false` و`provider_mutation_performed=false` و`secrets_included=false`.

## القراءة من startup و/deployment-info

يعرض startup event و`/deployment-info` كائن `runtime_bootstrap_status` DB-independent. الحالات الأساسية هي `bootstrap_not_configured` عند غياب hook صريح، و`bootstrap_required` عند وجود hook غير مكتمل، و`bootstrap_ready_for_explicit_invocation` عندما تكون metadata والـcredentials configured. حتى الحالة الأخيرة لا تعني أن apply حدث؛ `auto_apply`, `startup_apply`, `prestart_apply`, و`docker_start_apply` تظل `false`، وتظل mutation fields `false` في status.

## Verification checklist بعد التشغيل

بعد أي apply مصرح به يجب حفظ evidence للـexact SHA والهدف، وعدد الجداول قبل التنفيذ، ونتيجة migration، وpostconditions، وcanonical ledger، وgrant readback. ثم تعاد اختبارات session-context وMCP catalog وAdmin/System Tools وresponse-chunk persistence. لا تعتبر schema/ledger presence وحدها دليلًا على أن التطبيق يملك `INSERT` أو أن persistence live binding يعمل.
