# نظرة تنفيذية — عقد أتمتة متطلبات تطوير منظومة الأدلة وGemini

## الغرض

هذا الـSpec Kit يحول وثيقة المشروع التشغيلية إلى عقد Repository-native يمكن لأدوات التطوير والأتمتة قراءته بدل الاعتماد على وصف حر داخل المحادثات.

العقد يربط بصورة صريحة:

```text
هدف العمل
→ Requirement ID
→ Operation Path
→ Data/Contract Change
→ Task ID
→ Implementation Wave
→ Required Gates
→ Evidence Required
→ Completion State
```

## ما الذي يمكن أتمتته؟

- اكتشاف المهام الجاهزة والمهام المحجوبة.
- إنشاء Work Pack لكل PR دون توسيع النطاق.
- إنشاء Issues أو Checklists من المتطلبات.
- تحديد العقود والملفات المتوقع تعديلها.
- تحديد الاختبارات المطلوبة لكل Requirement.
- طلب أدلة CI أو Migration أو Deployment أو Runtime Readback المناسبة.
- منع إعلان الاكتمال عندما تكون هناك مهام أو Checklists غير مغلقة.
- إنتاج تقرير تسليم يوضح المنفذ والمتبقي والمخاطر والقرارات المفتوحة.
- استئناف العمل من آخر Checkpoint بصورة Idempotent.

## ما الذي لا يمنحه العقد؟

العقد لا يمنح صلاحية تنفيذ. لا يسمح منفردًا بإنشاء Migration أو استدعاء Gemini أو تعديل Google Drive أو الدمج أو النشر أو إرسال بيانات خارجية. كل Mutation تمر عبر Authority الحالية في المنصة.

## طبقات النظام

```text
Google Forms / Client Portal
→ Raw Intake
→ Context and policy validation
→ Evidence Registry
→ AI Job Queue
→ Gemini Gateway
→ Structured Result Validation
→ Human Review
→ Research / Audit / CRM / Task / Report
```

## دور Gemini

مسموح:

- تحليل النص والصورة والصوت والفيديو وPDF.
- استخراج JSON منظم.
- اقتراح التصنيف والتاجز واسم الملف والمسار.
- استخراج صوت العميل والاقتباسات وTimestamps.
- إنشاء سؤال استكمال قصير.
- اقتراح التشابه والتكرار.

غير مسموح:

- اعتماد Audit أو Finding.
- حذف ملف أو دمج سجل نهائيًا.
- منح صلاحية أو اختيار Tenant/Brand غامض.
- تنفيذ Function Call مؤثر مباشرة.
- إرسال ملف Restricted إلى مزود خارجي.
- اعتبار مخرجات الموديل حقيقة تشغيلية دون مراجعة.

## عقد أتمتة التطوير

الملف `development-automation.json` هو النسخة القابلة للقراءة الآلية. يحتوي على:

- Workstreams وImplementation Waves.
- Requirement وTask وAcceptance IDs.
- Dependencies وBlockers.
- الملفات والعقود المتوقعة.
- الاختبارات والبوابات.
- Evidence Types.
- Rollout وRollback Requirements.
- Open Decisions.
- حدود الصلاحية.

الـSchema الحاكم موجود في:

`contracts/development-automation.schema.json`

## مبدأ التنفيذ

كل موجة تنفيذ تكون PR محدودة وقابلة للمراجعة والرجوع. لا يبدأ Runtime implementation حتى تصبح مراجعة Work Maps جاهزة، وتغلق القرارات المؤثرة في الأمن والخصوصية والتكلفة والاحتفاظ والموديلات.

## ترتيب التنفيذ

1. عقود البيانات والحالات.
2. Evidence Registry وAI Job Ledger.
3. Forms وIntake.
4. Drive naming/routing/quarantine.
5. Gemini Gateway وSecret handling.
6. Structured extraction.
7. Review Queue والقرارات البشرية.
8. استبيانات العملاء.
9. Embeddings والتكرار الدلالي.
10. الصوت والفيديو.
11. Observability والتكلفة والاعتمادية.
12. Pilot وProduction hardening.

## قاعدة الاكتمال

لا يعني نجاح الكود أن المشروع اكتمل. الاكتمال يحتاج، حسب النطاق:

- Tasks وChecklists مغلقة.
- Exact-head CI ناجح.
- العقود متطابقة.
- Migration ledger مثبت إن وجدت Migration.
- Production/main parity.
- Runtime smoke وReadback.
- Manual fallback مجرب.
- عدم وجود Secrets في الأدلة.
- تصنيف أي عمل متبقٍ وإسناده بوضوح.
