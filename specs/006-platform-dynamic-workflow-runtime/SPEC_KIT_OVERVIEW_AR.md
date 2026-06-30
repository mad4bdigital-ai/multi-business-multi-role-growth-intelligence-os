# نظرة عامة عربية — Spec Kit 006

## الهدف

بناء Runtime موحد لتدفقات العمل الديناميكية يسمح للأدمن بنشر وكلاء ذكاء اصطناعي وتدفقات وقوالب مشتركة، ويسمح للمستأجر بتثبيتها وتخصيصها وتمديدها أو إنشاء fork محكوم أو أصل جديد خاص به.

## هيكل الملكية

```text
Platform Scope
└── Platform Admin Workspace
    └── Platform Brand
        ├── Platform Agents
        ├── Platform Workflows
        └── Runtime Bindings

Tenant Scope
└── Tenant Workspace
    └── Brand / Agents / Workflows
```

مساحات المستأجرين ليست داخل Workspace الأدمن. سلطة ال٣دمن عليها تأتي من Grants صريحة ومستقلة.

## نشر أصول المنصة

كل أصل يحمل سياسة إتاحة:

- `private`
- `platform_internal`
- `tenant_available`
- `tenant_default`
- `mandatory_policy`
- `deprecated`

الأصل المنشور كـ`tenant_available` يظهر في كتالوج المستأجر، ويمكن تثبيته وربطه بالـWorkspace أو النشاط التجاري أو البراند.

## خيارات المستأجر

- `install`: تثبيت أصل منصة مع مرجع نسخته.
- `override`: تعديل إعدادات مسموح بها ضمن حدود.
- `extend`: إضافة خطوات في extension points معلنة.
- `fork`: نسخة مستقلة مملوكة للمستأجر مع origin lineage.
- `tenant_authored`: أصل جديد مملوك للمستأجر.

لا يستطيع المستأجر توسيع الصلاحيات أو تعطيل الموافقات الإلزامية أو تجاوز عزل البيانات أو تشغيل Runtime غير معتمد.

## مبدأ التنفيذ

تعريف Workflow ونسخه وسياساته وحالته وتدقيقه وreadback تملكها المنصة. n8n وMake وMCP وغيرها مجرد Runtime Adapters قابلة للاستبدال.
