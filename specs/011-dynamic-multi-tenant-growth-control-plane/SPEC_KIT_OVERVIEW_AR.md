# نظرة تنفيذية: منصة نمو ديناميكية متعددة الـTenants والبراندات والأنشطة

## الهدف

المطلوب ليس إنشاء Workflow منفصل لكل عميل أو براند، بل إنشاء **Control Plane عام** يكوّن التشغيل وقت الطلب من بيانات وسجلات مهيكلة، بينما يبقى محرك التنفيذ والأمان ثابتًا ومختبرًا.

```text
Stable Runtime Kernel
+
Dynamic Control Plane
+
Versioned Registries and Schemas
+
Tenant / Brand / Activity Configuration
```

## ما يبقى ثابتًا

- المصادقة وعزل الـtenant.
- التحقق من الصلاحيات والموارد.
- التحقق من schemas.
- enforcement للموافقات.
- حماية الأسرار.
- idempotency وحالات التشغيل.
- audit وreadback وrollback.

## ما يصبح ديناميكيًا

- أنواع الأنشطة التجارية.
- ربط البراند بالنشاط والسوق واللغة والقنوات.
- Activity Packs وحزم المعرفة.
- capabilities والـworkflow graphs.
- إعدادات tenant/workspace/brand/plan.
- logic pointers ونسخ المعرفة.
- policies وapproval profiles.
- provider adapters وترتيب اختيارها.
- UI manifests والـfeature flags.
- KPI definitions وreadback contracts.

## نموذج النطاق

```text
Platform
└── Tenant
    ├── Users and memberships
    ├── Workspaces
    ├── Brands
    │   ├── Brand Core versions
    │   ├── Activity bindings
    │   ├── Provider/resource bindings
    │   └── Plans, approvals, runs and evidence
    └── Portfolio analytics
```

كل طلب تشغيلي يرتبط صراحةً بـtenant وworkspace وbrand وactivity وobjective. لا يجوز الاعتماد على آخر براند استخدمه المستخدم أو على اسم نصي غير canonical.

## Activity Packs

كل نشاط، مثل السفر أو التجارة الإلكترونية أو العقارات، يضاف كحزمة مسجلة تحتوي على:

- entity schemas.
- knowledge profile.
- KPI taxonomy.
- compatible capabilities and engines.
- workflow templates.
- risk and approval policies.
- provider compatibility.
- tests and fixtures.

إضافة نشاط جديد تتم عبر `register -> validate -> approve -> activate` وليس عبر إضافة شروط `if activity === ...` داخل قلب المنصة.

## الإعدادات والإصدارات

ترتيب الوراثة العام:

```text
Platform defaults
→ Activity defaults
→ Tenant overrides
→ Workspace overrides
→ Brand overrides
→ Plan overrides
→ Execution overrides
```

السياسات الأمنية تستخدم `deny_wins` ولا يمكن لطبقة أدنى إضعافها. كل تشغيل يحفظ snapshot للإعدادات ومصادرها والإصدارات المستخدمة مع SHA-256.

## الـCapabilities والـWorkflows

الـcapability هي وحدة صغيرة ذات عقد واضح، مثل:

- `intent_map_generate`
- `content_brief_generate`
- `conversion_spec_generate`
- `provider_draft_create`
- `readback_collect`

الـworkflow هو DAG يركب هذه الوحدات. إضافة أو إزالة خطوة تنشئ نسخة workflow جديدة ولا تعدل النسخة النشطة.

## الموافقة والتنفيذ

الموافقة ترتبط بـplan version وaction IDs والموارد والبيئة والمدة وبصمة الطلب. اعتماد insight أو خطة داخلية لا يسمح تلقائيًا بالكتابة على provider. الانتقال من internal draft إلى staging ثم production canary يحتاج موافقات مستقلة وreadback في كل مرحلة.

## قابلية النمو

هذا التصميم يسمح بـ:

- مستخدم واحد داخل عدة tenants.
- tenant واحد يملك عدة workspaces وبراندات.
- براند واحد يربط نشاطًا واحدًا أو أكثر بعقود واضحة.
- نفس capability تعمل في عدة أنشطة عند توافق schema والسياسة.
- تبديل provider دون تغيير الـworkflow.
- تعديل الإعدادات دون deploy عندما تكون القيمة ضمن schema موجودة.
- rollout وrollback حسب tenant أو brand أو cohort.

## القاعدة الذهبية

أي تشغيل يجب أن يجيب بدليل قابل للتتبع عن:

```text
من طلبه؟
لأي tenant وworkspace وbrand؟
تحت أي activity ونسخة إعدادات؟
بأي capability وworkflow وlogic وprovider؟
ما الذي تم اعتماده؟
ما المورد الذي تغير؟
ما readback الذي أثبت النتيجة؟
كيف يتم rollback؟
```

إذا كانت أي إجابة غامضة، يفشل التشغيل مغلقًا.
