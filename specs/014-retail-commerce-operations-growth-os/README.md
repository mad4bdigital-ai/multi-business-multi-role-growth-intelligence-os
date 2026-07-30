# Spec 014 — Retail Commerce, POS, Operations, Media, and Growth OS

## الغرض

هذه الحزمة تحول تجربة RetailOS التي تم تطويرها في النماذج التفاعلية من تصور واجهات إلى مواصفة Brownfield قابلة للتنفيذ داخل منصة **Multi-Business Multi-Role Growth Intelligence OS**.

الحزمة لا تفترض أن المنصة الحالية ERP أو POS جاهز. المراجعة البرمجية أثبتت أن الريبو يحتوي نواة قوية لإدارة السياق، الصلاحيات، الخطط، الموافقات، الـOutbox، الـWorkers، التكاملات، التتبع، الأدلة، والواجهات المحكومة؛ لكنه لا يحتوي حتى خط الأساس المرصود على Commerce Ledger متكامل للمنتجات والقطع والمخزون والحجوزات والطلبات والمدفوعات.

لذلك تقرر بناء قدرات التجارة كـ **Commerce Domain** أصلي فوق النواة الحالية، مع واجهة `Commerce Authority Adapter` تسمح باختيار مصدر حقيقة واحد لكل Workspace:

- `platform_native`: MySQL داخل المنصة هو مصدر الحقيقة التجاري.
- `erpnext`: ERPNext/Frappe هو مصدر الحقيقة التجاري من خلال Adapter معتمد.
- أي Adapter مستقبلي مثل Odoo يحتاج عقدًا وشهادة منفصلين.

لا يسمح بتفعيل مصدرين متوازيين للمخزون أو الطلبات في نفس Workspace.

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

## قرار المعمار

```text
Storefront / POS / Mobile / Admin
                |
                v
Governed Commerce API + Context Kernel
                |
                v
Commerce Authority Adapter
        |                       |
        v                       v
Platform Native Ledger     ERPNext/Frappe Adapter
        |                       |
        +-----------+-----------+
                    |
                    v
Transactional Outbox -> Catalogs / Analytics / Notifications / Growth
```

## لماذا هذا التصميم مناسب للريبو

يعيد استخدام قدرات قائمة بدل إنشاء منصة موازية:

- `contextKernel/` لحسم Tenant وWorkspace وBrand وResource وConnection.
- `platformOutbox.js` لنشر أحداث لا تخرج قبل Commit.
- `sequentialPlanOrchestrator.js` لمسارات التصوير والمورد والمرتجع والمحتوى.
- `approval_holds` للقرارات البشرية فقط.
- `queue.js` وBullMQ كوسيط تنفيذ، مع بقاء SQL مصدر حالة الأعمال.
- Resource API layering لنمط Route → Controller → Application → Domain → Infrastructure.
- Unified Platform Frontend وSurface Policy لتسجيل الواجهات Fail-closed.
- Provider/Connection registries لإدارة Google وMeta وTikTok وWhatsApp والدفع والشحن.
- Analytics bindings الحالية كأساس، مع إضافة Event Ledger وDeduplication وAttribution.
- Audit/Event Bus وExecution Log كأدلة لا تخزن أسرارًا أو Payloads خامًا.

## وثائق الحزمة

| الملف | الغرض |
|---|---|
| `spec.md` | المتطلبات الوظيفية وغير الوظيفية وحدود المنتج |
| `research.md` | مراجعة Brownfield للكود والقدرات الحالية |
| `demo-baseline.md` | تقرير كامل لما تم تنفيذه في الديمو ودرجة إثباته |
| `gap-and-reuse-matrix.md` | ماذا نعيد استخدامه وما يجب بناؤه |
| `concerns.md` | المخاطر الأمنية والتشغيلية والهندسية |
| `operation-paths.md` | المسارات العادية والبديلة والفشل والـReadback |
| `plan.md` | المعمار، مواضع الكود، ومراحل PRs |
| `data-model.md` | الجداول والحالات والمفاتيح والقيود |
| `acceptance-matrix.md` | التطابق بين الديمو والعقود واختبارات الإنتاج |
| `contracts/` | OpenAPI وJSON Schemas |
| `quickstart.md` | طريقة بدء التنفيذ والتحقق |
| `tasks.md` | مهام مرتبة حسب الاعتماد |
| `checklists/` | بوابات المتطلبات والأمن والتشغيل والتطابق |
| `completion.json` | حالة دورة الحياة والأدلة المطلوبة للإغلاق |

## مبادئ غير قابلة للتفاوض

1. مصدر حقيقة تجاري واحد لكل Workspace.
2. منع البيع المكرر يتم داخل Transaction في مصدر الحقيقة، لا داخل المتصفح.
3. حجز القطعة الفريدة لا يحتاج موافقة بشرية.
4. الـPOS غير المتصل لا يبيع قطعة فريدة إلا من Allocation Lease مسبق ومحدود.
5. كل Mutation لها Idempotency Scope وExpected Version وReadback.
6. الدفع ذو النتيجة غير المعروفة لا يعاد تلقائيًا قبل Reconciliation.
7. الصور والمحتوى المولد آليًا لا ينشران دون Quality Gate واعتماد عند الحقول الحساسة.
8. بيانات العملاء لا تدخل GA4 أو Logs أو Catalog Feeds.
9. Credentials تبقى في نظام الاتصالات والاعتماد، لا في جداول المنتجات أو الحملات.
10. الديمو لا يصبح Production Complete إلا بعد Contract Tests وRuntime Smoke على Backend حقيقي.

## حالة هذه الحزمة

- Specification only.
- لا توجد migrations مطبقة.
- لا توجد provider calls.
- لا توجد تغييرات Runtime.
- لا توجد أسرار.
- التنفيذ مخطط كحزمة Multi-PR مستقلة ومحكومة.
