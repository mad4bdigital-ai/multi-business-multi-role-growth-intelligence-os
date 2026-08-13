# Runbook: استعادة Write Authority في Production

## الغرض والنطاق

يشرح هذا الدليل كيفية تشخيص ومعالجة حالة تشغيلية يتعذر فيها على هوية قاعدة البيانات المستخدمة من runtime تنفيذ الكتابات المحدودة اللازمة لـDynamic Audit scheduler أو OpenAPI endpoint inventory sync. يعالج الإصدار البرمجي هذه الحالة بالتدهور الآمن، وبإيقاف scheduler بعد أول فشل صلاحيات قابل للتصنيف، وبإرجاع status صريح لمزامنة OpenAPI بدل إسقاط startup.

> هذا الدليل لا ينفذ grants أو migrations أو تغييرات مباشرة على Production. تنفيذ الخطوات التي تغيّر صلاحيات قاعدة البيانات أو إعدادات البيئة يحتاج مالك Production وتفويضًا منفصلًا.

يعتمد هذا الدليل على عقد [Dynamic Audit Runtime](../dynamic-audit-runtime-closure.md)، وعقد [OpenAPI Endpoint Inventory Synchronization](../openapi-endpoint-inventory-sync-2026-06-22.md)، وعقد [Governance DB Writer Authority](../governance-db-writer-authority.md). ولا ينطبق على مسار `feat/spec015-tenant-audit-convergence` المستثنى من نطاق هذه المراجعة.

## الأعراض والتصنيف

| العرض في السجل | السبب المرجح | السلوك بعد هذا الإصلاح | الإجراء التشغيلي |
|---|---|---|---|
| `ER_TABLEACCESS_DENIED_ERROR` على `dynamic_audit_scheduler_runs` | هوية runtime لا تملك `INSERT` أو لا تملك write authority لهذا الجدول | يجري startup probe داخل transaction ثم rollback. عند الرفض لا يبدأ interval، ويسجل `dynamic_audit_write_authority_unavailable` مرة واحدة | منح الحد الأدنى المراجع أو إبقاء scheduler معطلًا حتى تكتمل الموافقة |
| `ER_TABLEACCESS_DENIED_ERROR` على `actions` أو `endpoints` | OpenAPI inventory sync تعمل بـ`startup_apply=true` دون صلاحيات الكتابة اللازمة | يعيد startup `status=write_authority_unavailable` و`started=false` مع `secrets_included=false` بدل throw غير مصنف | تفعيل kill switch مؤقتًا أو إصلاح الصلاحيات ثم إعادة القراءة |
| تكرار `dynamic_audit_scheduler_runs` كل خمس دقائق | scheduler بدأ رغم عدم جاهزية writer | لا يُعاد تشغيل interval بعد فشل readiness أو cycle access-denied داخل العملية | لا تُنشئ retry خارجيًا قبل معالجة الصلاحية |
| `runtime_parity ... branch=Production, expected_branch=main` | هوية release/deployment branch لا تطابق release branch المحسوم | يبقى parity في حالة `skipped`/`degraded` ولا تُستنتج هوية deployed commit | راجع Environment Authority وmanifest؛ لا تغيّر branch authority من هذا runbook |
| `tenant_gpt_oauth_code_issue_failed` أو `response_chunk_persistence_unavailable` | مسار persistence آخر يفتقد write authority | يظل fail-closed/degraded حسب عقده ولا يُخلط مع صلاحيات scheduler أو OpenAPI | افتح incident مستقلًا للمسار المتأثر، ولا تمنحه صلاحيات أوسع تلقائيًا |
| Redis/queue disabled | SQL-cache optional fallback أو queue غير مفعّل | لا يُصنف كفشل write authority لهذا PR | لا تغيّر fallback policy دون عقد مستقل |

## مؤشرات النجاح الآمن

يُعد الإيقاف الآمن ناجحًا عندما تظهر نتيجة startup منظمة لا تحتوي على stack trace أو credential values، وتحتوي على `write_authority_unavailable=true` و`secrets_included=false`. بالنسبة إلى Dynamic Audit، يجب ألا يبدأ interval بعد رفض probe، أو يجب أن يتوقف interval بعد access-denied أثناء cycle. وبالنسبة إلى OpenAPI، يجب أن يبقى inventory غير callable وأن تعود startup بنتيجة degradation قابلة للرصد.

| المكوّن | الحالة المتوقعة عند نقص الصلاحية | هل يفشل process startup؟ | هل يكتب سجل فشل durable؟ |
|---|---|---:|---:|
| Dynamic Audit scheduler | `started=false`, `reason=write_authority_unavailable` | لا | لا؛ لأن جدول السجل نفسه غير قابل للكتابة |
| Dynamic Audit cycle | `ok=false`, `skipped=true`, `reason=write_authority_unavailable` | لا | يحاول تحديث سجل الدورة فقط إذا كان run قد سُجّل بنجاح |
| OpenAPI startup sync | `ok=true`, `started=false`, `status=write_authority_unavailable` | لا | قد يفشل سجل run نفسه إذا شملت المشكلة جدول evidence، ويظل ذلك degraded فقط |
| OpenAPI inventory rows | لا تُنشأ callable rows | لا | لا توجد promotion أو provider writes |

## إيقاف مؤقت بلا منح صلاحيات

### إيقاف OpenAPI inventory sync على مستوى العملية

اضبط متغير البيئة التالي في إعدادات الخدمة، ثم نفّذ restart عاديًا وفق إجراء المنصة المعتمد:

```bash
OPENAPI_ENDPOINT_INVENTORY_SYNC_DISABLED=true
```

هذه الخطوة لا تحذف inventory history ولا تعكس rows موجودة؛ إنها تمنع startup apply فقط. يجب التأكد من أن القيمة لا تُمرر إلى logs أو status endpoints، وأنها تعود إلى `false` أو تُزال بعد اكتمال recovery.

### إيقاف Dynamic Audit scheduler عبر runtime configuration

إذا كان المسار يملك صلاحية governed configuration، اجعل `dynamic_audit_scheduler` معطلًا باستخدام آلية التغيير المعتمدة في المنصة. الشكل الدلالي المطلوب هو:

```sql
UPDATE platform_runtime_config
   SET status='disabled',
       updated_at=UTC_TIMESTAMP()
 WHERE config_key='dynamic_audit_scheduler';
```

لا ينفذ هذا الأمر من PR ولا من هذه الجلسة. تحقق قبل وبعد التغيير من `config_key` و`status` فقط، ولا تطبع `config_json` إذا كان يحتوي على بيانات بيئية غير لازمة. ينص عقد Dynamic Audit على أن `enabled=false` أو `status='disabled'` يجعل startup والدورات المجدولة تتجاوز lock والكتابة.

## فصل هويات قاعدة البيانات

الخطأ في السجل يخص هوية runtime العادية، وليس دليلًا على أن Governance DB writer يجب أن يُستخدم بدلًا منها. الحد الفاصل هو:

| السطح | الهوية المقصودة | أمثلة العمليات | ملاحظة |
|---|---|---|---|
| Runtime reader/writer المحدود | هوية `DB_*` الخاصة بالخدمة، وفق contract مستقل لكل جدول runtime | `dynamic_audit_scheduler_runs`, `actions`, `endpoints`, وسجل OpenAPI عند تفعيله | يجب منح أقل صلاحية لازمة للمسار، ولا تُستبدل بـ`GOVERNANCE_DB_*` تلقائيًا |
| Governance writer | هوية منفصلة من `GOVERNANCE_DB_USER` و`GOVERNANCE_DB_PASSWORD` | capability envelope، governed migration authorization، وresource-authority binding creation | لا fallback إلى `DB_USER`/`DB_PASSWORD` |
| Production environment authority | branch/deployment authority المحكومة | `Production` وpromotion target `Production` | لا تمنح صلاحية SQL ولا تحل محلها |

## Minimum runtime privilege review

المصفوفة التالية هي قائمة تحقق للمسارات الظاهرة في سجل Production، وليست تفويضًا للـgrant. يجب أن يراجع مالك Production الاستعلامات الفعلية، schema الحالي، واحتياجات readback قبل إصدار أي صلاحية:

| جدول runtime | العملية التي يحتاجها المسار | سبب الحاجة | غير مطلوب من هذا الإصلاح |
|---|---|---|---|
| `dynamic_audit_scheduler_runs` | `INSERT` عند بدء run و`UPDATE` عند الإنهاء | تسجيل lifecycle للدورة وreadiness evidence | `DELETE`, `ALTER`, `DROP`, أو schema-wide write |
| `actions` | `INSERT ... ON DUPLICATE KEY UPDATE` | ضمان parent inventory action | promotion إلى callable action أو provider write |
| `endpoints` | `INSERT ... ON DUPLICATE KEY UPDATE` و`UPDATE` للـdeprecation | مزامنة inventory metadata وsame-cycle readback | جعل row callable أو إنشاء tool export |
| `openapi_endpoint_inventory_sync_runs` | `INSERT` عند evidence run | حفظ نتيجة sync وسبب الفشل | تخزين secrets أو raw provider payloads |
| `platform_runtime_config` | `SELECT` للقراءة؛ `UPDATE` فقط عبر مسار configuration محكوم | قراءة `enabled`, `startup_apply`, وkill state | تغيير config مباشرة من التطبيق دون governance |

## Minimum Governance DB writer matrix

هذه المصفوفة من [Governance DB Writer Authority](../governance-db-writer-authority.md)، وهي مستقلة عن runtime tables أعلاه. لا يجوز توسيعها إلى `GRANT ALL` أو صلاحيات إدارية.

| جدول Governance | الحد الأدنى للعمليات |
|---|---|
| `capability_resolution_envelope_ledger` | `SELECT, INSERT, UPDATE` |
| `approval_holds` | `INSERT` |
| `governed_migration_authorization_registry` | `SELECT, INSERT, UPDATE` |
| `capability_apply_authorization_policy_registry` | `SELECT, INSERT, UPDATE` |
| `runtime_dispatch_certification_registry` | `SELECT, INSERT, UPDATE` |
| `governed_migration_ledger` | `SELECT` |
| `platform_resource_authority_bindings` | `SELECT, INSERT` |

لا تمنح `DELETE`, `DROP`, `ALTER`, `CREATE`, `FILE`, `PROCESS`, `SUPER`، أو account-management authority إلا بعقد منفصل يثبت الحاجة. يجب أن تبقى قيم `GOVERNANCE_DB_*` سرية، وألا تُطبع أو تُحفظ في artifacts أو status responses.

## خطوات Recovery بعد منح الصلاحية من المالك

بعد أن يقرر مالك Production أن الصلاحية الدنيا صحيحة، اتبع التسلسل التالي دون إعادة استخدام evidence قديم:

1. تحقق من وجود الجداول المطلوبة ومن أن الهوية المقصودة هي نفس الهوية التي ظهرت في سجل الخطأ، مع عدم عرض كلمة المرور أو token.
2. شغّل readiness probe bounded من أداة التشغيل المعتمدة. يجب أن يثبت probe العملية المطلوبة فقط، وأن ينظف transaction الاختبارية بالـrollback، وألا يترك صفًا تجريبيًا.
3. عطّل kill switch إن كان مفعّلًا، ثم اجعل `startup_apply=true` فقط بعد تأكيد أن OpenAPI rows ستظل `inventory_only` و`runtime_callable=false`.
4. أعد تفعيل Dynamic Audit عبر configuration governance، ثم راقب دورة واحدة. لا تُنشئ interval إضافيًا يدويًا ولا تشغّل process مزدوجًا لتجاوز advisory lock.
5. راجع structured startup events: `dynamic_audit_scheduler_start` و`openapi_endpoint_inventory_sync_start`. عند نقص الصلاحية يجب أن ترى status degradation منظمًا لا stack trace.
6. راجع same-cycle readback وعدد rows، ثم شغّل `inventory:check` و`evaluation:enforce` على المرشح الذي سيُرقّى. لا تعتبر log قديمًا أو branch mismatch دليلًا على Production parity الحالي.
7. إذا بقي `branch=Production, expected_branch=main`، أوقف recovery عند نقطة parity، واطلب تصحيح release/deployment authority وفق العقد؛ لا تغيّر القيمة في manifest أو تتجاوز الحارس يدويًا.

## Rollback وحدود المسؤولية

إذا عاد access-denied أو ظهرت كتابة غير متوقعة، أعد تفعيل kill switch لـOpenAPI واضبط scheduler إلى disabled عبر المسار المحكوم، ثم احتفظ بالـstructured logs. لا تحذف run evidence ولا rows inventory للتخلص من العرض. لا ينفذ هذا PR grants أو migrations أو deploy/restart، ولا يثبت بمفرده أن Production أصبحت جاهزة.

| الإجراء | داخل PR | يحتاج مالك Production |
|---|---:|---:|
| تصنيف access-denied وتدهور runtime | نعم | لا |
| اختبار transaction probe محليًا/fake pool | نعم | لا |
| تعديل `OPENAPI_ENDPOINT_INVENTORY_SYNC_DISABLED` في Production | لا | نعم |
| `UPDATE platform_runtime_config` في Production | لا | نعم |
| إنشاء principal أو تنفيذ `GRANT` | لا | نعم |
| تشغيل migration أو deployment/restart | لا | نعم |
| إثبات runtime parity بعد promotion | لا | نعم |

## مراجع المستودع

- [Dynamic Audit Runtime Closure](../dynamic-audit-runtime-closure.md)
- [OpenAPI Endpoint Inventory Synchronization](../openapi-endpoint-inventory-sync-2026-06-22.md)
- [Governance DB Writer Authority](../governance-db-writer-authority.md)
- [Production runtime parity evidence contract](../../.changes/e2e/production-runtime-parity-evidence.json)
