# نظرة تنفيذية — عقد أتمتة تطوير واختبار منظومة الأدلة وGemini

## الغرض

هذا الـSpec Kit يحول وثيقة المشروع التشغيلية إلى عقود Repository-native يمكن لأدوات التطوير وCI قراءتها بدل الاعتماد على وصف حر داخل المحادثات.

أصبح المشروع يملك عقدين مترابطين:

```text
development-automation.json
ماذا يجب تنفيذه؟

ci-automation.json
كيف نثبت أن ما تم تنفيذه صحيح وعلى أي Commit؟
```

المسار الكامل:

```text
هدف العمل
→ Requirement ID
→ Operation Path
→ Data/Contract Change
→ Task ID
→ Implementation Wave
→ Work Packet + Plan Hash
→ Test Families
→ CI Pipelines
→ Canonical Evidence
→ Completion State
```

## ما الذي يمكن أتمتته؟

- اكتشاف المهام الجاهزة والمهام المحجوبة.
- إنشاء Work Packet لكل PR دون توسيع النطاق.
- إنشاء Issues أو Checklists من المتطلبات.
- تحديد العقود والملفات المتوقع تعديلها.
- تحديد الاختبارات المطلوبة لكل Requirement وTask.
- تصنيف الملفات المتغيرة إلى Test Families.
- منع PR من تعديل مسارات خارج نطاق المهمة.
- تقسيم الاختبارات إلى Diagnostic Shards عند الفشل.
- إنتاج إحداثيات دقيقة لإعادة تشغيل الاختبار الفاشل.
- ربط كل تقرير بالـHead أو Merge Candidate الذي تم اختباره فعلًا.
- تحويل تقارير متعددة إلى Canonical Evidence واحد.
- طلب أدلة CI أو Migration أو Deployment أو Runtime Readback المناسبة.
- منع إعلان الاكتمال عندما تكون Tasks أو Checklists أو أدلة التشغيل ناقصة.
- إنتاج تقرير تسليم يوضح المنفذ والمتحقق والمحجوب والمؤجل وغير المملوك.
- استئناف العمل من آخر Checkpoint بصورة Idempotent.

## ما الذي لا تمنحه العقود؟

العقود لا تمنح صلاحية تنفيذ. لا تسمح منفردة بـ:

- إنشاء أو تطبيق Migration.
- استدعاء Gemini.
- تعديل Google Drive أو Forms أو Sheets.
- منح صلاحية.
- دمج PR أو النشر.
- Force Push.
- كتابة ملفات مولدة عن بعد.
- إرسال بيانات خارجية.
- إعلان الاكتمال بناءً على وصف أو Log قديم.

كل Mutation تمر عبر Authority مستقلة ومحددة وتفويض مرتبط بالـSHA أو Checksum ثم Readback.

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

الملف `development-automation.json` يحتوي على:

- 52 Functional Requirements.
- 18 Acceptance Criteria.
- 9 Operation Paths.
- 12 Implementation Waves.
- 24 Tasks.
- Dependencies وBlockers.
- Allowed Paths وForbidden Actions.
- Required Tests وGates وEvidence.
- Rollout وRollback.
- 10 Open Decisions.
- Resume Keys وPlan Hash inputs.

الـSchema الحاكم:

`contracts/development-automation.schema.json`

الأدوات التنفيذية للـSpec:

```text
tools/validate-contracts.mjs
tools/generate-work-packet.mjs
```

الأداة الأولى تفحص سلامة العقود والروابط والـDependencies والـWriter policy والـCompletion consistency. الثانية تولد Work Packet حتميًا لمهمة محددة، وتعرض بوضوح أسباب كونها Ready أو Blocked.

## عقد أتمتة CI

الملف `ci-automation.json` يستخلص منطق CI المفيد في المستودع ويكيفه للمشروع، ويتضمن:

- 10 Test Families مرتبطة بالمتطلبات والمهام.
- 9 Pipelines منطقية.
- 8 Structured Evidence Contracts.
- Exact Candidate Binding.
- Changed-Scope Fail-Closed.
- Phase/Task Governance.
- Dynamic Diagnostic Sharding.
- Ordered Sequential Progress.
- Canonical Evidence Router.
- Trusted PR Evidence Publisher.
- Read-only Generated Artifact Validator.
- Separately Authorized Sole Writer.
- Release Completion Gate.

الـSchema الحاكم:

`contracts/ci-automation.schema.json`

والشرح العربي المفصل:

`CI_AUTOMATION_BLUEPRINT_AR.md`

## المبادئ المستخرجة من CI الحالية

### 1. Exact Candidate Binding

كل نتيجة ترتبط بـ:

- Repository.
- Candidate kind.
- Candidate SHA.
- Source Head SHA.
- Head/Base refs.
- Workflow run ID.
- Task/Wave/Plan Hash عند الحاجة.

ويُرفض أي تقرير Stale أو يخص Head آخر.

### 2. Changed-Scope Fail-Closed

```text
Changed files
→ Test Family
→ Requirement/Task coverage
→ Required gates
→ Failure if unclassified
```

### 3. Diagnostic Evidence ليست Status Authority

الـShards والـLogs تساعد على التشخيص، بينما Canonical Structured Summary هي مصدر حالة الـWorkflow.

### 4. Validation Read-Only by Default

عند اكتشاف Generated Output قديم، تنتج CI Repair Candidate مربوطًا بالـExact Head، لكنها لا تعمل Commit أو Push.

### 5. Sole Governed Writer

أي Autofix مستقبلي يحتاج:

- Writer واحد لكل Root.
- One-time authorization.
- Exact expected Head SHA.
- Allowed-root-only diff.
- Idempotency proof.
- No force push.
- Remote head reread وPushed SHA readback.
- Dispatch صريح للـCI بعد الكتابة.

### 6. Completion Beyond Merge

نجاح CI أو دمج الكود لا يكفي. الاكتمال يحتاج Migration وDeployment وProduction Readback وManual Fallback وRollback عند انطباقها.

## مبدأ التنفيذ

كل موجة تنفيذ تكون PR محدودة وقابلة للمراجعة والرجوع. لا يبدأ Runtime implementation حتى تصبح مراجعة Work Maps جاهزة، وتغلق القرارات المؤثرة في الأمن والخصوصية والتكلفة والاحتفاظ والموديلات.

ولا يتم إنشاء جميع Workflows بصلاحيات واسعة دفعة واحدة. ترتيب CI المقترح:

1. Spec Contract Validator وCanonical Summary.
2. Phase Governance وWork Packet Scope Gate.
3. Dynamic Diagnostic Shards.
4. Canonical Evidence Router وTrusted Publisher.
5. Generated Artifact Validator وAuthorized Writer.
6. Release Completion Gate.

## ترتيب تطوير المنتج

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
- Work Map readiness.
- Exact-head CI ناجح.
- Canonical Evidence يطابق Workflow conclusion.
- العقود والمخرجات المولدة متطابقة.
- Migration checksum وLedger إذا وجدت Migration.
- Production/main parity.
- Runtime smoke وReadback.
- Manual fallback مجرب.
- Rollback مجرب.
- عدم وجود Secrets في الأدلة.
- تصنيف أي عمل متبقٍ وإسناده بوضوح.

## الحالة الحالية

- عقود التطوير وCI موجودة على الفرع.
- أدوات التحقق وتوليد Work Packet موجودة.
- لم تُفعّل Workflows جديدة بعد.
- لم يُشغّل Gemini.
- لم تُطبق Migration.
- لم يحدث Deployment.
- `completion.json` يظل `in_progress` حتى ظهور أدلة Exact-head والتحقق الرسمي.
