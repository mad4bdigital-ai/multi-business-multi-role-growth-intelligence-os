# خارطة المعالجة طويلة المدى لـ Spec 020

## الوضع والحدود

هذه الخارطة توسعة توثيقية وعقدية لـPR #7417. وهي لا تحوّل هذا الطلب إلى مسار تشغيل Production، ولا تمنح runtime authority، ولا تطبق migrations أو grants، ولا تقرأ credentials، ولا تنفذ provider أو database mutations. جميع العقود المضافة في هذه الدفعة تحمل صراحةً الحالة `prepared-only` والسلطة `shadow-library-only`.

> الهدف من هذه الدفعة هو تحويل فجوات الصلاحيات والجلسات والـreadback والـcapability certification إلى حدود قابلة للقياس والتقسيم، لا الادعاء بأن صلاحيات Production قد أُصلحت.

## الفجوات التي لا يغلقها PR #7417

يظل إصلاح `ER_TABLEACCESS_DENIED_ERROR` في `customer_sessions` و`gpt_session_turns`، وتخزين OAuth authorization codes، وكتابة `execution_log` و`json_assets` و`actions` و`dynamic_audit_scheduler_runs`، ومسار promotion وTenant dispatch، خارج التنفيذ الفعلي لهذا PR. يمكن لهذا PR أن يعرّف العقود والفحوصات المطلوبة ويمنع التفعيل عند غيابها، لكنه لا يغير principal أو schema أو privileges في قاعدة البيانات.

## الحزمة العقدية المضافة إلى PR #7417

| العقد | الغرض | الحالة في هذا PR | ما يمنعه صراحةً |
|---|---|---|---|
| `runtime-db-write-authority-profiles.json` | تعريف profiles منفصلة للجلسات وOAuth وinventory وobservability وchunks وgovernance | prepared-only registry | fallback إلى `DB_USER`، صلاحيات schema-wide، `GRANT` و`REVOKE` |
| `runtime-environment-invariant-contract.json` | تثبيت مساواة requested/resolved/credential/provider environment | synthetic/readback contract | cross-environment fallback، اختيار Production الضمني، خلط hosts وcredential namespaces |
| `control-plane-persistence-resilience-contract.json` | فصل execution receipt عن payload persistence، وفرض bounded summary وpagination | prepared-only resilience contract | إعادة تنفيذ mutation بسبب فشل payload، silent truncation، اعتماد التنفيذ على chunk writer |
| `capability-identity-certification-contract.json` | ربط capability بالـendpoint وresource scope وفرض certification/readback | prepared-only certification contract | `dispatch-allowed` يدويًا أو بدون resource binding/readback/certification |

## ترتيب PRs التشغيلي بعد هذه الدفعة

### Patch 0 — Runtime environment enforcement

الاسم المقترح: `feat(spec020-runtime): enforce environment-aware execution contract`. يحمّل `prompt_router` و`module_loader` و`system_bootstrap` وprovider dispatch قيمة `environment_key` صريحة، ثم يثبت في same-cycle readback أن البيئة المطلوبة والمحلولة وبيئة credentials وبيئة provider host متطابقة. هذا المسار يحتاج route wiring وموافقة تشغيلية منفصلة، ولذلك لا يُنفذ داخل حدود PR #7417 الحالية.

### Patch 1 — Canonical DB Write Authority Profiles

الاسم المقترح: `feat(db): introduce canonical write authority profiles`. ينقل مصدر الحقيقة المستقبلي إلى registry SQL-primary يضم `profile_key` و`environment_key` و`table_name` و`allowed_operations` و`identity_env_prefix` و`requires_same_cycle_readback` و`status`. يجب أن يرفض compiler أي write غير مربوط، وألا يستخدم dedicated writer fallback إلى `DB_USER`. لا تتضمن هذه الدفعة SQL migration أو grant.

### Patch 2 — Session Continuity Writer

الاسم المقترح: `fix(session): introduce dedicated session continuity write authority`. يختص بـ`customer_sessions` و`gpt_session_turns` فقط، مع استخراج العمليات من query inventory الفعلي، وdedicated pool، وsame-cycle readback، واختبار revoked privilege وglobal write privilege. لا يجوز اعتبار `runtime-database-readiness-contract` تنفيذًا لهذا الإصلاح.

### Patch 3 — OAuth / Identity Writer

الاسم المقترح: `fix(identity): isolate oauth durable persistence authority`. يختص بـ`tenant_gpt_oauth_authorization_codes` مع one-time atomic consumption وTTL وreplay protection وtenant/user scope validation، ومنع fallback إلى runtime principal. يجب أن يبقى مستقلًا عن Session Writer.

### Patch 4 — Operational and Observability Writers

يُقسّم إلى `runtime_inventory_writer` للجداول `actions` و`endpoints` و`dynamic_audit_scheduler_runs` و`openapi_endpoint_inventory_sync_runs`، و`observability_sink_writer` للجداول `execution_log` و`json_assets`. العمليات يجب أن تكون table-scoped ومحدودة إلى lifecycle المطلوب، وليست promotion أو provider writes.

### Patch 5 — Control-plane persistence resilience

الاسم المقترح: `fix(control-plane): decouple tool execution from durable response persistence`. يطبق receipt صغيرًا durable قبل payload الكبير، ويعيد receipt مع bounded summary عند فشل تخزين payload، ويفرض pagination/source-side limits. يظل `runtime_chunk_writer` مخصصًا لـ`governed_tool_response_chunks` ولا يجوز توسيعه تلقائيًا إلى بقية الجداول.

### Patch 6 — Endpoint-scoped capability identity

الاسم المقترح: `fix(capability): resolve canonical identity at endpoint binding scope`. المفتاح الصحيح هو `(tool_name, parent_action_key, endpoint_key, resource_scope)` وليس `tool_name` منفردًا. يجب أن تنتج طبقة الحل `CAPABILITY_IDENTITY_MISSING=0` و`CAPABILITY_AMBIGUOUS=0` للأسطح المستهدفة قبل السماح بالترقية.

### Patch 7 — Generic certification and readback engine

يوحد العقد `capability_key` و`risk_class` و`preflight_contract` و`apply_contract` و`readback_contract` و`rollback_contract` و`resource_binding` و`evidence_ttl`. الانتقال يكون من `registered` إلى `authority-ready` ثم `preflight-passed` ثم `certified` ثم `dispatch-allowed` ثم `apply` ثم `same-cycle-readback` ثم `exported`. لا يسمح بأي انتقال إلى `dispatch-allowed` عند غياب evidence أو binding أو certification.

### Patch 8 — Tenant graduated promotion

الاسم المقترح: `feat(tenant): promote connection capabilities through certified stages`. حالات الترقية هي `shadow` ثم `read_only` ثم `bounded_workspace_write` ثم `provider_write` لكل Tenant/connection، مع adapter smoke وcredential plan وresolver validation وresource binding وreadback certification وcanary وrollback. لا يوجد `enabled=true` عالمي.

### Patch 9 — Runtime release attestation

يضيف health/activation evidence غير سري يثبت `environment` و`source_sha` و`release_id` و`schema_version` و`authority_profile_version` وreadiness لكل writer. ولا يعتبر promotion ناجحًا إلا إذا تطابق `requested_sha` و`deployed_sha` و`runtime_reported_sha` مع schema وauthority readback في نفس الدورة.

## Dependency graph

```text
#7417
  |
  +--> Patch 0: Runtime environment enforcement
  |
  +--> Patch 1: Canonical DB authority profiles
  |       +--> Patch 2: Session continuity writer
  |       +--> Patch 3: OAuth identity writer
  |       +--> Patch 4: Operational and observability writers
  |
  +--> Patch 5: Control-plane persistence resilience
  |
  +--> Patch 6: Endpoint-scoped capability identity
          |
          +--> Patch 7: Generic certification/readback
                  |
                  +--> Patch 8: Tenant graduated promotion

Patch 9: Runtime release attestation can begin early,
        but its Production readback is separately authorized.
```

## معايير القبول المشتركة

لا تُعتبر أي حزمة تشغيلية مكتملة إلا بعد إثبات dedicated identity، وminimum table operations، وعدم وجود fallback إلى generic principal، وschema/readback evidence، وrevoked-privilege fail-closed test، وsame-cycle identity/resource/result readback، ووجود rollback contract. يجب أن تكون جميع الأدلة مربوطة بـenvironment وsource SHA وauthority profile version.

## قرار الدمج لهذه التوسعة

هذه التوسعة مناسبة للدمج كطبقة **P0/P1 preparation and governance hardening** داخل PR #7417، لكنها لا تُقدّم كإصلاح P0 التشغيلي نفسه. يبقى تفعيل runtime وDB authority وProduction promotion في PRs لاحقة مستقلة، مع موافقة تشغيلية صريحة لكل بيئة وكل writer profile.

