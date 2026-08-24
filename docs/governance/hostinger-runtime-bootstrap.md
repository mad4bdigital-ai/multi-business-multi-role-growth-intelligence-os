# Hostinger Runtime Bootstrap Contract

## Repository-owned Host Breakglass catalog

`http-generic-api/config/host-breakglass-catalog.json` هو كتالوج الاستعادة المستقل عن قاعدة البيانات، و`host-breakglass-tool-contracts.json` هو عقد الأدوات المنفصل. يعرضان قدرات قابلة للاكتشاف بدل تكرار قائمة migrations ثابتة: فحص وإعادة بناء schema bundle لقاعدة فارغة، فحص وتطبيق migrations المملوكة للريبو، إصلاح grants، وقراءة postconditions والـledger. تبقى أسماء migrations والـchecksums من `runtime-bootstrap-contract.json` عند الـSHA المستهدف فقط.

توفر Admin surface عمليات catalog وplan وdispatch وstatus دون استخدام operation orchestrator أو MCP catalog أو session tables. الـdispatch ثابت على هذا المستودع وworkflow `production-runtime-parity-evidence.yml` و`ref=main`، بينما يثبت الـworkflow بشكل مستقل رأس Production والـSHA المنشورة حيًا.

إعادة البناء الكامل مسموحة فقط لقاعدة غير موجودة أو ذات صفر جداول، وتستخدم schema bundle وseeds وmigrations وsame-cycle readback. grants تنفذ لاحقًا بعقد `database.access_repair` وموافقة مستقلة. هذا المسار لا يسقط جداول قاعدة غير فارغة؛ الاستبدال يتطلب target جديدًا أو lifecycle منفصلة مع backup proof.

### استثناء Raw SQL وShell

يسمح Host Breakglass بـRaw SQL وshell عبر `host.command_capsule` فقط. لا تقبل Admin API نص SQL أو shell inline. يجب حفظ الأمر في `.github/breakglass/sql/*.sql` أو `.github/breakglass/shell/*.sh` وربطه بمسار وSHA-256 وexact source SHA وconfirmation من الصيغة `EXECUTE_HOST_BREAKGLASS_CAPSULE:<environment-key>:<sha>:<capsule-sha256>`.

Production SQL ينفذ من GitHub Environment بحساب `MYSQL_BOOTSTRAP_*` المنفصل، ويحتاج evidence داخل `.github/breakglass/evidence/*.json` يثبت backup صالحًا وrestore test ناجحًا لنفس target والـSHA ولم تنته صلاحيته. يمنع executor أوامر إنشاء/حذف قاعدة، وإدارة المستخدمين، وGRANT/REVOKE، وقراءة/كتابة ملفات الخادم. يحتفظ SQL بحرية DDL/DML داخل قاعدة الهدف حسب صلاحيات حساب bootstrap.

Shell يعمل في Staging داخل خدمة Docker Compose المحددة في عقد Staging، ويعمل في Production عبر SSH adapter مستقل عن DB يستخدم نفس credential roles الحاكمة الموجودة في المنصة. Production يحتاج private key وknown-hosts مثبتًا وbackup/restore evidence. لا يعاد stdout أو stderr إلى API؛ تعاد بصماتهما وأحجامهما وحالة الخروج فقط. التنفيذ يستخدم argv مع `shell:false` و`BatchMode=yes` و`StrictHostKeyChecking=yes` وtimeout محدود، ولا يستخدم `ssh-keyscan` وقت التنفيذ.

الكتالوج يفصل بيئتين: `staging_local_windows_docker` يعمل من Windows checkout محلي عبر Docker وlocal CLI ولا يملك Hostinger أو GitHub workflow authority، بينما `production_hostinger_autodeploy` يستخدم GitHub dispatch على `main` ثم يثبت رأس `Production` وHostinger Auto Deploy parity. أسماء credentials ووسيلة التنفيذ وbranch bindings منفصلة، وأي cross-environment dispatch مرفوض.

هذا العقد يضيف مسارًا مستقلًا ومحدودًا لمعالجة قواعد runtime التي تكون ناقصة schema أو غير جاهزة للصلاحيات. وهو لا يضعف `/gpt/tools` أو `/gpt/tools/call` أو مسارات session-context؛ هذه المسارات تظل DB-backed ومحمية بطبقات authorization المعتادة.

> **قاعدة أساسية:** تشغيل `npm start` أو `prestart` أو Docker لا يطبق migrations أو grants. حالة التطبيق التشخيصية لا تعني أن bootstrap حدث، ونجاح Auto Deploy لا يساوي نجاح SQL apply.

## الأوضاع

الأمر الافتراضي هو `plan`، وهو لا يفتح اتصالًا بقاعدة البيانات. وضع `dry_run` يقرأ هوية الهدف وعدد الجداول والـschema prerequisites والـledger والـpostconditions والـgrant evidence فقط. لا يوجد وضع combined باسم `apply`: `apply_migration` و`apply_grants` مرحلتان مستقلتان، ولكل منهما confirmation مستقل مرتبط بالـSHA والهدف والهوية. أي فشل بعد بدء DDL أو GRANT يعلن `mutation_state=partial_possible` ولا يدّعي أن قاعدة البيانات لم تتغير.

| الوضع | اتصال DB | SQL mutation | الاستخدام |
|---|---:|---:|---|
| `plan` | لا | لا | عرض العقد وعدم التنفيذ |
| `dry_run` | نعم | لا | قراءة parity وschema/ledger/grant evidence |
| `apply_migration` | نعم | migration مرشح فقط، دون grants | تطبيق 20260815 بعد confirmation مستقل وpostcondition/ledger readback |
| `apply_grants` | نعم | GRANT محدود فقط، دون migration | تطبيق SELECT/INSERT/UPDATE للجداول الستة بعد migration readiness وconfirmation مستقل |
| `execute_sql_capsule` | نعم | Raw SQL داخل قاعدة الهدف | استثناء Production/Staging مثبت بالريبو؛ Production يحتاج backup وrestore evidence |
| `execute_shell_capsule` | Docker Staging أو Hostinger SSH | shell مثبت بالريبو | Staging داخل container؛ Production عبر key وknown-hosts وbackup evidence وموافقة GitHub Environment |

## المتغيرات الحاكمة

يجب تمرير المتغيرات من GitHub Environment/Variables/Secrets أو من release hook محمي. لا تضع كلمات المرور في command line أو ملفات log.

| المجموعة | المتغيرات | القاعدة |
|---|---|---|
| المصدر | `BOOTSTRAP_EXPECTED_SHA`, `BOOTSTRAP_EXPECTED_BRANCH`, `BOOTSTRAP_EXPECTED_REPOSITORY` | SHA كامل بطول 40، والفرع `Production` والمستودع canonical |
| الهدف | `RUNTIME_BOOTSTRAP_TARGETS_JSON`, `BOOTSTRAP_TARGET_KEY`, `BOOTSTRAP_TARGET_DATABASE` | الهدف يجب أن يكون allowlisted مع `database_sha256` و`target_fingerprint` المطابقين |
| الحساب | `MYSQL_BOOTSTRAP_HOST`, `MYSQL_BOOTSTRAP_PORT`, `MYSQL_BOOTSTRAP_USER`, `MYSQL_BOOTSTRAP_PASSWORD`, `MYSQL_BOOTSTRAP_DATABASE` | حساب مستقل عن `DB_*` وعن `target.principal`؛ لا يوجد fallback إلى runtime credentials |
| migration | `BOOTSTRAP_MIGRATION` | `20260815` فقط قابلة لـ`apply_migration`؛ `225` و`1048` verification-only مع readiness readback |
| تأكيد migration | `BOOTSTRAP_MIGRATION_CONFIRMATION` | `APPLY_HOSTINGER_RUNTIME_MIGRATION:<exact-sha>:<target-key>:<migration-file>` |
| تأكيد grants | `BOOTSTRAP_GRANTS_CONFIRMATION` | `APPLY_HOSTINGER_RUNTIME_GRANTS:<exact-sha>:<target-key>:<principal>:<principal-host>` |
| bundle | `BOOTSTRAP_SCHEMA_BUNDLE_MANIFEST` | مطلوب فقط لمسار zero-table بعد توليد bundle canonical ومثبت المصدر والـchecksum |
| Production SSH variables | `HOSTINGER_PROD_SSH_HOST`, `HOSTINGER_PROD_SSH_PORT`, `HOSTINGER_PROD_SSH_USER` | تحفظ كـGitHub Environment Variables؛ لا حاجة لوضعها في Hostinger `.env` |
| Production SSH secrets | `HOSTINGER_PROD_SSH_PRIVATE_KEY`, `HOSTINGER_PROD_SSH_KNOWN_HOSTS` | تحفظ كـGitHub Environment Secrets؛ public key المقابل يضاف إلى Hostinger، ولا يستخدم password أو `ssh-keyscan` وقت التنفيذ |

لا تعرض قيمة `RUNTIME_BOOTSTRAP_TARGETS_JSON` أو credentials في التقرير النهائي. يكتب البرنامج evidence محدودًا ويعلن دائمًا `secrets_included=false`.

لإنشاء known-hosts من جهاز موثوق استخدم المنفذ المعروض في hPanel، ثم قارن بصمة المفتاح مع مصدر مستقل قبل حفظ السطر في GitHub. لا تنسخ private key أو password إلى المحادثات أو ملفات المستودع. Hostinger `.env` يخص عملية التطبيق على الخادم، بينما SSH Breakglass يبدأ من GitHub runner، لذلك وضع private key في `.env` يزيد نطاق التسريب ولا يضيف وظيفة.

## المسار الحالي غير المتصل بقاعدة البيانات

للمعاينة فقط:

```bash
cd http-generic-api
npm run runtime-bootstrap:plan
```

لا يطبق هذا الأمر شيئًا ولا يحتاج أي credential. أما dry-run ومرحلتا apply فتحتاج injection للمتغيرات من secret manager، ثم:

```bash
cd http-generic-api
npm run runtime-bootstrap:dry-run
npm run runtime-bootstrap:apply-migration
npm run runtime-bootstrap:apply-grants
```

يجب تشغيل `apply-migration` ثم مراجعة evidence وpostconditions/ledger، وبعد موافقة مستقلة فقط تشغيل `apply-grants`. لا تُشغّل أيًا منهما بconfirmation مجمعة؛ alias `runtime-bootstrap:apply` وflag `--apply` مرفوضان عمدًا. لا يفترض هذا المستودع وجود Hostinger release hook فعّال؛ يجب أن تكون دعوة كل مرحلة جزءًا من إعداد تشغيلي منفصل ومراجع.

## قواعد قاعدة البيانات

### قاعدة nonempty الحالية

إذا كان عدد الجداول أكبر من صفر، يُمنع baseline schema bundle. بالنسبة إلى الحادثة الحالية، المسار الصحيح هو قراءة prerequisites ثم تنفيذ `20260815_custom_gpt_mcp_catalog_levels.sql` فقط بعد التأكد من وجود `admin_platform_endpoint_tools` و`tenant_platform_endpoint_tools`. بعدها تُقرأ postconditions الخاصة بـ`mcp_catalog_level` وindexes وfeedback row، ثم تُقرأ/تُسجل canonical ledger evidence. لا تُطبق grants في دورة migration؛ grants لها preflight مستقل يتحقق من وجود الجداول الستة كلها قبل أول GRANT، ثم readback في الدورة نفسها. صلاحيات runtime المطلوبة محصورة في `SELECT, INSERT, UPDATE` للجداول الستة التالية فقط:

`customer_sessions`, `gpt_session_turns`, `actions`, `dynamic_audit_scheduler_runs`, `execution_log`, و`json_assets`.

### قاعدة zero-table

لا يستخدم المسار `schema.sql` وحده كضمان؛ فهو baseline جزئي وليس current runtime schema كاملًا. يجب أولًا إنتاج `runtime.schema.sql.gz` من الـcanonical staging schema-bundle producer على checkout محلي disposable وبـexact source SHA، مع manifest يثبت `schema_only=true`، وعدم الوصول إلى Production/provider، وعدم تصدير البيانات، وعدم وجود secrets. بعد ذلك فقط يقبل bootstrap manifest إذا طابق SHA والـtable list والـcompressed checksum، ويطبق runtime وgovernance schema bundles ثم seed prerequisites `039_sprint43_data_integrity_and_missing_tables.sql` و`1043_sprint69_dynamic_container_hvac_activity_seed.sql`. تُنفذ `20260815_custom_gpt_mcp_catalog_levels.sql` بعدها كـincident apply candidate مرة واحدة، ثم يعيد المسار postconditions والـledger والـgrants.

إذا غاب bundle أو كان source SHA أو table count أو checksum غير مطابق، يفشل المسار قبل mutation. لا يسمح هذا العقد بتشغيل مجلد migrations كامل على قاعدة Production فارغة.

## GitHub workflow

يوفر المستودع مسارًا يدويًا داخل workflow recovery القائم `.github/workflows/production-runtime-parity-evidence.yml` عبر مدخلات `bootstrap_mode` (`disabled|plan|dry_run|apply_migration|apply_grants|execute_sql_capsule|execute_shell_capsule`) و`bootstrap_target_key` و`bootstrap_target_database` و`bootstrap_migration` وconfirmation الخاصة بالمرحلة. تحمل عمليتا capsule مدخل JSON واحدًا محدودًا باسم `host_breakglass_capsule` يحوي المسار والبصمة وbackup evidence؛ ولا يوجد مدخل SQL أو shell inline. يبدأ `bootstrap_mode` معطّلًا؛ و`plan` لا يفتح اتصالًا بقاعدة البيانات، و`dry_run` للقراءة فقط، وكل mutation مشروطة بـEnvironment approval وconfirmation وallowlist مستقلة. لا يعمل هذا المسار ضمن `npm start` أو `prestart` أو Docker أو Hostinger Auto Deploy. يجب أن تظل القيم الفعلية للـtarget وcredentials في إعدادات GitHub المناسبة، مع عدم تضمينها في PR أو logs.

يجب أن يمر مسار bootstrap داخل workflow بالترتيب التالي: يثبت أن `expected_sha` هو رأس `Production`، يعمل checkout لنفس الـSHA، يتحقق من بصمة عقد الأدوات والـcapsule من ذلك checkout، ويشغّل contract tests، ثم ينفذ الوضع الصريح فقط. قبل `dry_run` أو أي mutation ينفذ الـworkflow فحصًا GET-only محدودًا إلى `https://auth.mad4b.com/version` و`https://auth.mad4b.com/deployment-info`. يجب أن يعيد كلاهما SHA المنشور المطابقًا تمامًا لـ`expected_sha`، ويجب أن يثبت `/deployment-info` فرع `Production`. بعد SQL أو SSH capsule يعاد فحص Hostinger للتأكد من بقاء النشر على الـSHA نفسها. أي HTTP failure أو JSON غير صالح أو SHA فارغ أو mismatch أو فرع مختلف يوقف المسار fail-closed قبل فتح اتصال bootstrap أو SSH. لا يصنف أي 502 من Hostinger أو غياب route كنجاح؛ direct bootstrap path لا يعتمد على `/gpt/tools/call`.

يشغّل job العقد مباشرةً `test-runtime-bootstrap-contract.mjs` و`test-runtime-gate-deployment-info-parity.mjs` و`hostinger-runtime-bootstrap.mjs --plan`، حتى لا يبقى اختبار parity مجرد ملف موثق غير منفذ. تُحفظ نتيجة parity التشغيلية في evidence محدود، مع `read_only=true` و`mutation_performed=false` و`provider_mutation_performed=false` و`secrets_included=false`. في حالات الفشل بعد بدء العملية، يتضمن evidence `mutation_evidence` بعدّاد statements/tables المكتملة وحالة `partial_possible`، ولا يُعاد إنشاء ledger بعد migration إلا بعملية separate, explicit write.

## القراءة من startup و/deployment-info

يعرض startup event و`/deployment-info` كائن `runtime_bootstrap_status` DB-independent. الحالات الأساسية هي `bootstrap_not_configured` عند غياب hook صريح، و`bootstrap_required` عند وجود hook غير مكتمل، و`bootstrap_ready_for_explicit_invocation` عندما تكون metadata والـcredentials configured. حتى الحالة الأخيرة لا تعني أن apply حدث؛ `auto_apply`, `startup_apply`, `prestart_apply`, و`docker_start_apply` تظل `false`، وتظل mutation fields `false` في status.

## Verification checklist بعد التشغيل

بعد كل مرحلة مصرح بها يجب حفظ evidence للـexact SHA والهدف والـprincipal/host، وعدد الجداول قبل التنفيذ، ونتيجة العملية، وpostconditions، وcanonical ledger، وgrant preflight/readback، و`mutation_evidence`. ثم تعاد اختبارات session-context وMCP catalog وAdmin/System Tools وresponse-chunk persistence. ويجب أن يثبت dry-run لـ225 بنية ledger والسياسة والأداة، وأن يثبت dry-run لـ1048 الأعمدة والفهارس وreadiness view؛ schema/ledger presence وحدها لا تكفي لإثبات أن التطبيق يملك `INSERT` أو أن persistence live binding يعمل.

## اكتشاف الهدف من بيئة Hostinger نفسها

عندما لا يعرف المشغّل اسم قاعدة البيانات، لا ينبغي تخمينها من اسم القاعدة أو حجمها في hPanel، ولا نسخ ملف `.env` إلى GitHub. أضيف مسار `runtime_env` مخصص لـ`dry_run` فقط؛ يقرأ `DB_NAME` و`DB_USER` و`GOVERNANCE_DB_NAME` من بيئة التطبيق المحلية، ويشتق `MYSQL_BOOTSTRAP_DATABASE` من `DB_NAME` إذا لم يكن محددًا. لا يستخدم هذا المسار `DB_USER` أو `DB_PASSWORD` كحساب bootstrap، ولا يسمح بأي `apply`.

التحميل من ملف Hostinger ليس ضمن `npm start` ولا `prestart`، بل يجب أن يكون صريحًا عبر أمر الـCLI:

```bash
cd http-generic-api
npm run runtime-bootstrap:host-env-dry-run
```

وهذا يعادل:

```bash
node scripts/hostinger-runtime-bootstrap.mjs --dry-run --target-source runtime_env --env-file=.env
```

يقوم البرنامج بالتحقق من source SHA والفرع والـmigration allowlist وحساب bootstrap المخصص قبل أي اتصال. evidence تعرض `target_key` وhashes وconfigured flags فقط، وتضع `raw_values_exposed=false` و`secrets_included=false`. يجب أن يبقى `.env` خارج GitHub وخارج logs، وأن تُحفظ كلمات المرور في Hostinger Environment variables/secret store وفق إعدادات الاستضافة الرسمية.

هذا المسار مناسب للتشخيص والـreadback فقط. أما `apply_migration` و`apply_grants` فيستمران باستخدام `repository_allowlist` و`RUNTIME_BOOTSTRAP_TARGETS_JSON` الموقّع/المثبت، مع approvals المستقلة الحالية. لا يعتبر نجاح `runtime_env` dry_run تفويضًا للتطبيق.

### ملاحظة Hostinger

يستطيع Hostinger استيراد `.env` أثناء إعداد Node.js أو تعديل Environment variables بعد النشر، لكن تغييرات المتغيرات تحتاج rebuild/redeploy لتأخذ أثرًا في التطبيق. لذلك يكون Hostinger Environment variables هو المصدر التشغيلي المفضل، بينما Server Files `.env` لا يصبح فعالًا إلا إذا استُخدم صراحةً عبر `--env-file` أو إعداد تشغيل مكافئ. لا يستطيع GitHub Actions قراءة Server Files مباشرةً.

## Centralized per-environment configuration and minimum setup

Use the application `.env` as the source of truth for each environment. Staging reads its Windows/Docker application configuration; Production reads its existing Hostinger application configuration. Do not duplicate `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, or `DB_PASSWORD` into environment-specific SSH or bootstrap variables merely to inspect the runtime.

The existing protected `/deployment-info/runtime-bootstrap-dry-run` route authenticates using the existing `BACKEND_API_KEY`, validates exact Production SHA, branch, and repository, and executes in `runtime_env` mode on the Hostinger host itself. For this read-only mode only, host, port, database, username, and password can be derived from the existing `DB_*` runtime configuration. Evidence identifies this identity as `runtime_read_only`; it never grants migration, grant, shell, SQL-capsule, or mutation authority. The same credentials remain denied for every apply mode and for repository-allowlist mutation.

The existing GitHub App integration (`GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`) is reused if it already exists in Hostinger. Do not create replacements solely for Host Breakglass. The existing `BACKEND_API_KEY` must match the already-configured repository/environment secret used by the workflow; reuse that key rather than creating another service credential.

Repository-allowlist execution derives its database name directly from the already-configured `RUNTIME_BOOTSTRAP_TARGETS_JSON` entry matching `BOOTSTRAP_TARGET_KEY`. An explicitly supplied `bootstrap_target_database` must match that governed entry. No `MYSQL_BOOTSTRAP_DATABASE` GitHub Variable is required.

A privileged mutation cannot acquire permissions that the existing runtime database identity does not possess. If migration or grant repair is required and no dedicated bootstrap identity already exists, the irreducible additional Hostinger `.env` settings are `MYSQL_BOOTSTRAP_USER` and `MYSQL_BOOTSTRAP_PASSWORD`; host, port, and database are derived from `DB_HOST`, `DB_PORT`, and `DB_NAME` when executing the read-only runtime path. Never reuse `DB_USER` or `DB_PASSWORD` for a privileged mutation.

Production SSH is optional and required only for the separate `execute_shell_capsule` transport. Do not configure `HOSTINGER_PROD_SSH_*` when only catalog inspection, runtime binding, or backend-key-authenticated `runtime_env` dry-run is needed. SSH key and pinned-host setup becomes necessary only if a remote SSH shell capability is explicitly activated later.
