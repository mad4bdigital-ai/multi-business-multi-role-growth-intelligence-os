# Spec 014 — Retail Commerce, POS, Operations, Media, Growth, and Workspace File Fabric

## الغرض

هذه الحزمة تحول تجربة RetailOS التي تم تطويرها في النماذج التفاعلية من تصور واجهات إلى مواصفة Brownfield قابلة للتنفيذ داخل منصة **Multi-Business Multi-Role Growth Intelligence OS**.

كما توسع المعمار ليصبح مناسبًا للتوافق طويل المدى مع الأنظمة الخارجية، وتضيف **Workspace File Fabric (نسيج إدارة ملفات مساحة العمل)** كقدرة منصة عامة تمكّن أي مستخدم مصرح له من إدارة ملفاته في Google Drive أو مزود ملفات معتمد بكفاءة تشغيلية، مع العزل والصلاحيات والـReadback والتدقيق.

الحزمة لا تفترض أن المنصة الحالية ERP أو POS أو File Manager جاهز. المراجعة البرمجية أثبتت أن الريبو يحتوي نواة قوية لإدارة السياق، الصلاحيات، الخطط، الموافقات، الـOutbox، الـWorkers، الاتصالات، Google OAuth، الرفع، التتبع، الأدلة، والواجهات المحكومة؛ لكنه لا يحتوي حتى خط الأساس المرصود على Commerce Ledger متكامل أو Workspace File Domain إنتاجية كاملة.

## القرار المعماري المحسن

القاعدة الحاكمة أصبحت:

```text
One Authoritative Writer per Bounded Domain per Workspace
مصدر كتابة واحد لكل مجال محدود داخل كل مساحة عمل
```

أمثلة:

- المنتجات والمخزون والطلبات: ERPNext أو Platform Native.
- الدفع: Payment Authority مع Provider Readback.
- الشحن: Shipping Authority.
- الملفات: Google Drive أو File Authority أخرى.
- القياس: Platform Measurement Ledger.
- أداء الإعلانات: Platform Fact Ledger.

لا يسمح بمصدرين قابلين للكتابة في نفس المجال والنطاق.

المنصة تظل الحد الثابت للتجربة والحوكمة والسياق والسياسات والتنسيق والأدلة، بينما تعمل الأنظمة الخارجية من خلال **Canonical Domain Ports (منافذ مجال موحدة)** و**Certified Adapters (موصلات معتمدة)**.

## ما اكتمل في الديمو

تم تطوير ستة أجيال من الديمو، وانتهت النسخة السادسة إلى نموذج تعاقدي يشمل:

- متجر عربي Responsive مع البحث والفلاتر والمقارنة والسلة والحجز والـCheckout.
- POS وفروع ومخزون وقطع فريدة وحماية من البيع المكرر.
- حالات حجوزات ومدفوعات وطلبات ومرتجعات وفشل واسترداد.
- استلام الموردين وفحص الجودة.
- استوديو تصوير، Shot Lists، معالجة صور، AI Draft، اعتماد بشري ونشر متعدد القنوات.
- GA4/GTM Event Model، Catalog Feeds، إسناد الإعلانات ومساهمة الربح.
- CRM وخدمة العملاء والشكاوى والـAudit Feedback.
- Live Commerce.
- أدوار وصلاحيات وسجل Evidence.
- Outbox وIdempotency وState Machines وAPI Traces في المحاكاة.
- عقد تنفيذ JSON وتقرير Smoke Test لـ71 مسارًا دون أخطاء متصفح في بيئة الديمو.

كل ذلك دليل تصميم وسلوك متوقع فقط، وليس دليل إنتاج أو قاعدة بيانات أو Provider execution.

## Workspace File Fabric

القدرة الجديدة المخططة تغطي:

- Personal Workspace وCompany Workspace وBrand ownership.
- قائمة الملفات والمجلدات والبحث وقراءة Metadata والمحتوى المسموح.
- إنشاء المجلدات والرفع الصغير والرفع Resumable للملفات الكبيرة.
- إنشاء Google Docs وSheets وSlides من خلال الـAPI المناسبة.
- إعادة التسمية والنقل والنسخ والأرشفة وTrash وRestore.
- Permissions وExternal Sharing وOwnership Transfer كقدرات منفصلة محكومة.
- Revisions وShared Drives وDrive Changes API.
- Batch Operations مع Idempotency لكل ملف واستكمال الفشل فقط.
- Manifest وChecksums وParent/Size/MIME Readback.
- ربط الملفات بالمنتجات والحملات والموردين والعملاء والـWorkflows والأدلة.
- بحث مفهرس يعيد فحص الصلاحية الحية قبل إظهار النتيجة.
- واجهة عربية RTL Responsive وأدوات Agents تستخدم نفس Application Services.

المسار المرجعي الإلزامي هو نفس نمط العمل المنفذ في هذه المحادثة:

```text
Resolve Root
→ Create Child Folder
→ Create Categorized Subfolders
→ Upload HTML / Images / Contracts / Reports / ZIP
→ Archive Historical Copies
→ Generate Manifest and Checksums
→ Read Back Counts, Parents, MIME Types, Names, and Sizes
→ Resume Failed Items without Duplicating Completed Writes
```

## قرار المعمار

```text
Storefront / POS / Admin / Mobile / Agents / ChatGPT
                         |
                         v
              Governed Platform APIs
                         |
                         v
 Context Kernel + Effective Authority + Capability Policy
                         |
                         v
              Domain Application Services
                         |
                  Canonical Domain Ports
                         |
        +----------------+------------------+
        |                |                  |
        v                v                  v
 Commerce Adapter   Workspace File     Payment/Shipping/
                    Authority Adapter   Catalog Adapters
        |                |                  |
        v                v                  v
 ERPNext/etc.       Google Drive/etc.  External Providers

Shared guarantees:
Domain Authority Registry / Anti-Corruption Mapping
Transactional Outbox / Provider Webhook Inbox
Idempotency / Unknown Outcome Readback
Adapter Certification / Audit / Reconciliation
```

## لماذا هذا التصميم مناسب للريبو

يعيد استخدام قدرات قائمة بدل إنشاء منصة موازية:

- `contextKernel/` لحسم Tenant وWorkspace وBrand وResource وConnection.
- Spec 012 لحوكمة ملكية الاتصالات الشخصية واتصالات الشركة والبراند.
- `googleAuthTokenResolver.js` لحسم Scopes والاتصال الدقيق.
- `appAdapters/googleDrive.js` كنموذج Transport أولي يحتاج تعميقًا.
- `driveFileLoader.js` لدعم قراءة ملفات وShared Drives.
- `uploadPipeline.js` لأنماط IDs والحالة والرفع والـReadback.
- `platformOutbox.js` لنشر أحداث لا تخرج قبل Commit.
- Provider Webhook Inbox المخططة للأحداث الداخلة.
- `sequentialPlanOrchestrator.js` لمسارات التصوير والمورد والمرتجع وBatch File Operations.
- `approval_holds` للقرارات البشرية عالية المخاطر فقط.
- `queue.js` وBullMQ كوسيط تنفيذ، مع بقاء SQL أو Provider Authority مصدر حالة الأعمال.
- Resource API layering لنمط Route → Controller → Application → Domain → Infrastructure.
- Unified Platform Frontend وSurface Policy لتسجيل الواجهات Fail-closed.
- Provider/Connection registries لإدارة Google وMeta وTikTok وWhatsApp والدفع والشحن.
- Audit/Event Bus وExecution Log كأدلة لا تخزن أسرارًا أو Payloads خامًا.

## وثائق الحزمة

| الملف | الغرض |
|---|---|
| `spec.md` | المتطلبات الوظيفية وغير الوظيفية وحدود المنتج |
| `research.md` | مراجعة Brownfield للكود والقدرات الحالية |
| `demo-baseline.md` | تقرير كامل لما تم تنفيذه في الديمو ودرجة إثباته |
| `gap-and-reuse-matrix.md` | ماذا نعيد استخدامه وما يجب بناؤه |
| `external-system-and-workspace-file-fabric.md` | المعمار الحاكم للتكاملات وGoogle Drive وإدارة الملفات |
| `adapter-certification.md` | حزمة اعتماد الموصلات والاختبارات الإلزامية |
| `concerns.md` | المخاطر الأمنية والتشغيلية والهندسية |
| `operation-paths.md` | المسارات العادية والبديلة والفشل والـReadback |
| `plan.md` | المعمار، مواضع الكود، ومراحل PRs |
| `data-model.md` | الجداول والحالات والمفاتيح والقيود |
| `acceptance-matrix.md` | التطابق بين الديمو والعقود واختبارات الإنتاج |
| `external-integration-and-drive-acceptance.md` | 56 اختبار قبول للتكاملات وWorkspace File Fabric |
| `external-integration-and-drive-tasks.md` | مهام التنفيذ الإضافية مرتبة حسب الاعتماد |
| `contracts/retail-commerce-operations.openapi.yaml` | عقد Commerce API |
| `contracts/workspace-files.openapi.yaml` | عقد إدارة الملفات Personal/Workspace/Brand |
| `contracts/domain-authority-adapter.schema.json` | عقد سلطة المجال والـAdapter والاعتماد |
| `contracts/provider-webhook-inbox.schema.json` | عقد الأحداث الداخلة والتوقيع والـDeduplication |
| `contracts/commerce-events.schema.json` | أحداث Commerce |
| `contracts/commerce-provider-adapter.schema.json` | عقد Commerce Adapter |
| `quickstart.md` | طريقة بدء التنفيذ والتحقق |
| `tasks.md` | مهام Commerce الأساسية |
| `checklists/` | بوابات المتطلبات والأمن والتشغيل والتطابق |
| `completion.json` | حالة دورة الحياة والأدلة المطلوبة للإغلاق |

## مبادئ غير قابلة للتفاوض

1. مصدر كتابة واحد لكل Bounded Domain ونطاق.
2. لا Route أو UI أو Agent يختار Provider أو Connection بنفسه.
3. External IDs لا تمنح Authority.
4. الـAdapters تترجم وتنقل وتقرأ النتيجة؛ لا تملك Business Policy.
5. Outbox للأحداث الخارجة وWebhook Inbox للأحداث الداخلة.
6. النتيجة غير المعروفة لا يعاد تنفيذها قبل Readback.
7. Adapter غير معتمدة لا تصبح مصدر كتابة.
8. منع البيع المكرر يتم داخل Transaction في مصدر الحقيقة، لا داخل المتصفح.
9. حجز القطعة الفريدة لا يحتاج موافقة بشرية.
10. الـPOS غير المتصل لا يبيع قطعة فريدة إلا من Allocation Lease مسبق ومحدود.
11. كل Mutation لها Idempotency Scope وExpected Version وReadback.
12. Google Sign-In لا يعني Google Drive consent.
13. الاتصال الشخصي لا يستخدمه عضو آخر لمجرد عضويته في Workspace.
14. Consequential write لا يستخدم Silent Fallback من Brand إلى Workspace أو Personal.
15. حذف الملف افتراضيًا يعني Trash؛ Permanent Delete قدرة عالية المخاطر مستقلة.
16. Public أو External Sharing لا تدخل ضمن write_file العامة.
17. Credentials وSigned URLs وRaw Provider Payloads وPrivate Content لا تدخل Logs أو Evidence أو GPT context.
18. الديمو أو Mock Adapter لا يثبتان Production readiness.

## حالة هذه الحزمة

- Specification only.
- لا توجد migrations مطبقة.
- لا توجد provider calls.
- لا توجد تغييرات Runtime.
- لا توجد تغييرات فعلية على Google Drive.
- لا توجد أسرار.
- التنفيذ مخطط كحزمة Multi-PR مستقلة ومحكومة.
