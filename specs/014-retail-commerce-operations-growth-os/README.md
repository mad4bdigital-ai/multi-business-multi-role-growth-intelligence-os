# Spec 014 — Brand-Scoped Retail Commerce, POS, Operations, Media, Growth, and Workspace File Fabric

## الغرض

هذه الحزمة تحول تجربة RetailOS من نماذج تفاعلية إلى مواصفة Brownfield قابلة للتنفيذ داخل منصة **Multi-Business Multi-Role Growth Intelligence OS**.

كما توسع المعمار ليتوافق مع الأنظمة الخارجية وتضيف **Workspace File Fabric (نسيج إدارة ملفات مساحة العمل)** كقدرة عامة لإدارة Google Drive أو أي File Authority معتمدة، مع العزل والصلاحيات والـReadback والتدقيق.

الحزمة لا تفترض أن المنصة الحالية ERP أو POS أو File Manager مكتمل. مراجعة الريبو أثبتت وجود نواة قوية للسياق والصلاحيات والخطط والموافقات والـOutbox والـWorkers والاتصالات وGoogle OAuth والرفع والتتبع والأدلة والواجهات المحكومة، مع غياب Commerce Ledger وWorkspace File Domain إنتاجيتين كاملتين.

## التعديل الحاكم: التجارة مرتبطة بالبراند

الـWorkspace حاوية إدارية وتعاونية، لكنه لا يكفي وحده كسلطة تجارة إلكترونية.

القاعدة الحاكمة أصبحت:

```text
One Authoritative Writer per Bounded Domain per Brand Scope
مصدر كتابة واحد لكل مجال محدود داخل نطاق براند محدد
```

كل Commerce Command أو Event أو Aggregate أو Job أو Approval أو Provider Delivery يجب أن يحمل Brand محددة وغير فارغة.

يشمل ذلك:

- المنتجات والـVariants والـStock Units؛
- الأسعار والمخزون والحجوزات؛
- Checkout والطلبات وPOS؛
- الدفع والشحن والمرتجعات؛
- الموردين والتصوير والمحتوى؛
- Google Merchant وMeta وTikTok وWhatsApp؛
- GA4 وGTM والـPixels والقياس والإسناد؛
- ملفات المنتج والحملات والموردين والأدلة على Google Drive.

أي صياغة أقدم داخل الحزمة تعامل Brand كاختيارية للتجارة أو تجعل سلطة التجارة على Workspace فقط، تعد معدلة ومسبوقة بـ`brand-scoped-commerce-authority.md`.

## Brand Commerce Profile

كل Brand تحتاج ملف تشغيل حاكم يضم:

- الحالة والإصدار؛
- العملة واللغة والمنطقة الزمنية؛
- سياسات السعر والمرتجع والموافقة والخصوصية؛
- الفروع والمخازن ونقاط البيع والقنوات؛
- ERP أو Commerce Backend؛
- الدفع والشحن؛
- Merchant Center وMeta وTikTok؛
- GA4 وGTM والـPixels؛
- WhatsApp والاتصالات؛
- Brand File Profile وجذور Google Drive.

لا يبدأ التنفيذ التجاري العادي قبل أن تكون Brand Profile نشطة، وسلطات المجالات واتصالاتها محددة وغير متعارضة.

## الاتصالات الخاصة بالبراند

الاتصال التجاري يكون أحد الأنواع التالية:

```text
brand_owned
workspace_delegated
platform_managed
```

الاتصال المملوك للـWorkspace لا يصبح متاحًا للبراند تلقائيًا. يلزم تفويض صريح يحدد:

- Brand؛
- المجال؛
- Capability؛
- Connection؛
- مدة التفويض؛
- Policy وBinding Revision.

لا يوجد Silent Fallback من Brand إلى Workspace أو Personal، ولا يمكن استخدام اتصال Brand آخر.

## معمار التنفيذ

```text
Storefront / POS / Admin / Mobile / Agents / ChatGPT
                         |
                         v
              Governed Platform APIs
                         |
                         v
 Context Kernel + Brand Authority + Capability Policy
                         |
                         v
              Domain Application Services
                         |
                  Canonical Domain Ports
                         |
       +-----------------+------------------+
       |                 |                  |
       v                 v                  v
Commerce Adapter   Workspace File      Payment/Shipping/
                   Authority Adapter    Catalog Adapters
       |                 |                  |
       v                 v                  v
ERPNext/etc.       Google Drive/etc.   External Providers

Shared guarantees:
Brand Domain Authority / Anti-Corruption Mapping
Transactional Outbox / Provider Webhook Inbox
Idempotency / Unknown Outcome Readback
Adapter Certification / Audit / Reconciliation
```

## Workspace File Fabric وGoogle Drive

تدعم القدرة المخططة:

- Personal Workspace؛
- Company Workspace؛
- Brand File Areas.

أما الملفات المرتبطة بالتجارة فتستخدم Brand scope حصرًا من خلال `Brand File Profile` تتضمن الاتصال والجذر وجذورًا فرعية للمنتجات والحملات والموردين وخدمة العملاء والأدلة والأرشيف.

القدرات تشمل:

- List/Search/Read/Export؛
- إنشاء المجلدات والرفع الصغير وResumable Upload؛
- Google Docs وSheets وSlides؛
- Rename/Move/Copy/Archive؛
- Trash/Restore وPermanent Delete المحكومة؛
- Permissions وExternal Sharing وOwnership Transfer؛
- Revisions وShared Drives وDrive Changes API؛
- Batch Operations مع Idempotency واستكمال الفشل فقط؛
- Manifest وChecksums وParent/Size/MIME Readback؛
- ربط الملفات بالمنتجات والحملات والموردين والعملاء والـWorkflows والأدلة؛
- بحث يعيد فحص السلطة الحية قبل إظهار المحتوى.

المسار المرجعي الإلزامي:

```text
Resolve Brand File Profile
→ Resolve Brand Drive Connection and Root
→ Create Child Folder
→ Create Categorized Subfolders
→ Upload HTML / Images / Contracts / Reports / ZIP
→ Archive Historical Copies
→ Generate Brand-Scoped Manifest and Checksums
→ Read Back Counts, Parents, MIME Types, Names, Sizes, and Brand Bindings
→ Resume Failed Items without Duplicating Completed Writes
```

## ما اكتمل في الديمو

تم تطوير ستة أجيال من الديمو شملت:

- متجر عربي Responsive وفلاتر ومقارنة وسلة وCheckout؛
- POS وفروع ومخزون وقطع فريدة ومنع البيع المكرر؛
- حجوزات ومدفوعات وطلبات ومرتجعات وفشل واسترداد؛
- الموردين وفحص الجودة؛
- استوديو تصوير وShot Lists ومعالجة صور وAI Draft واعتماد بشري؛
- GA4/GTM وCatalog Feeds وإسناد الإعلانات ومساهمة الربح؛
- CRM والشكاوى وLive Commerce؛
- أدوار وصلاحيات وEvidence وOutbox وIdempotency وState Machines؛
- عقد تنفيذ وتقرير Smoke Test لـ71 مسارًا في بيئة الديمو.

هذه أدلة تصميم وسلوك متوقع وليست دليل Production أو Provider Execution.

## لماذا هذا التصميم مناسب للريبو

يعيد استخدام:

- `contextKernel/` لحسم Tenant وWorkspace وBrand وResource وConnection؛
- Spec 012 لحوكمة ملكية الاتصالات الشخصية واتصالات الشركة والبراند؛
- `googleAuthTokenResolver.js` لحسم Scopes والاتصال الدقيق؛
- `appAdapters/googleDrive.js` كنموذج Transport أولي؛
- `driveFileLoader.js` للقراءة وShared Drives؛
- `uploadPipeline.js` لأنماط الرفع والحالة والـReadback؛
- `platformOutbox.js` للأحداث بعد Commit؛
- `sequentialPlanOrchestrator.js` لمسارات التصوير والمورد والمرتجع وBatch Files؛
- `approval_holds` للقرارات البشرية عالية المخاطر؛
- BullMQ كوسيط تنفيذ مع بقاء SQL أو Provider Authority مصدر الحقيقة؛
- Resource API layering؛
- Unified Platform Frontend وSurface Policy؛
- Provider/Connection registries؛
- Audit/Event Bus وExecution Log.

## وثائق الحزمة الرئيسية

| الملف | الغرض |
|---|---|
| `spec.md` | المتطلبات الأساسية؛ تعدلها الوثيقة المعيارية الخاصة بالبراند عند التعارض |
| `brand-scoped-commerce-authority.md` | القواعد المعيارية الإلزامية لسياق البراند واتصالاته وGoogle Drive |
| `brand-commerce-acceptance.md` | اختبارات قبول العزل والربط والتوجيه حسب البراند |
| `brand-commerce-tasks.md` | مهام التنفيذ والترحيل والاختبارات |
| `contracts/brand-commerce-context.schema.json` | عقد Brand Commerce Context والاتصالات |
| `research.md` | مراجعة Brownfield للكود الحالي |
| `demo-baseline.md` | ما تم تنفيذه في الديمو وحدود إثباته |
| `external-system-and-workspace-file-fabric.md` | معمار التكاملات وإدارة الملفات |
| `adapter-certification.md` | اعتماد الموصلات |
| `plan.md` و`data-model.md` | المعمار والبيانات ومراحل التنفيذ |
| `contracts/retail-commerce-operations.openapi.yaml` | عقد Commerce API |
| `contracts/workspace-files.openapi.yaml` | عقد Workspace Files |
| `contracts/domain-authority-adapter.schema.json` | سلطة المجالات والـAdapters |
| `contracts/provider-webhook-inbox.schema.json` | الأحداث الداخلة والتوقيع والـDeduplication |
| `contracts/commerce-events.schema.json` | أحداث Commerce الإلزامية بالبراند |
| `checklists/brand-commerce.md` | بوابة مراجعة البراند والعزل والاتصالات |
| `completion.json` | حالة دورة الحياة وأدلة الإغلاق |

## مبادئ غير قابلة للتفاوض

1. Brand إلزامية لكل تجارة، والـWorkspace وحدها لا تمنح Commerce Authority.
2. مصدر كتابة واحد لكل Bounded Domain داخل Brand scope.
3. لا Route أو UI أو Agent يختار Provider أو Connection بنفسه.
4. External IDs لا تمنح Authority.
5. الاتصالات إما Brand-owned أو مفوضة للبراند صراحةً.
6. لا Silent Fallback بين Brand وWorkspace وPersonal أو بين البراندات.
7. كل جداول ومفاتيح وCaches وEvents وOutbox وInbox الخاصة بالتجارة تحفظ Brand.
8. الـAdapters تترجم وتنقل وتقرأ النتيجة ولا تملك Business Policy.
9. Outbox للأحداث الخارجة وWebhook Inbox للأحداث الداخلة.
10. النتيجة غير المعروفة لا تعاد قبل Readback بنفس Brand context.
11. Adapter غير معتمدة لا تصبح مصدر كتابة.
12. منع البيع المكرر يتم داخل Transaction في مصدر الحقيقة.
13. Google Sign-In لا يعني Google Drive consent.
14. ملفات التجارة تستخدم Brand File Profile ولا تعتمد على Personal Drive.
15. حذف الملف افتراضيًا Trash، وPermanent Delete قدرة مستقلة عالية المخاطر.
16. Credentials وSigned URLs وRaw Provider Payloads وPrivate Content لا تدخل Logs أو Evidence أو Agent context.
17. الديمو أو Mock Adapter لا يثبتان Production readiness.

## حالة الحزمة

- Specification only.
- لا توجد Migrations مطبقة.
- لا توجد Provider Calls.
- لا توجد تغييرات Runtime.
- لا توجد تغييرات فعلية على Google Drive.
- لا توجد أسرار.
- التنفيذ مخطط كحزمة Multi-PR مستقلة ومحكومة.
