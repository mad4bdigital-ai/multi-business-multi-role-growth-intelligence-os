# مخطط أتمتة CI للمشروع — مستخرج من منطق المستودع

## 1. الهدف

الغرض ليس نسخ ملفات GitHub Actions حرفيًا، بل استخراج المبادئ التشغيلية التي جعلت CI في المستودع قادرًا على:

- معرفة ما الذي تغير وما الاختبارات المطلوبة له.
- منع بدء التنفيذ أو إعلان الاكتمال إذا كانت المواصفات أو العقود ناقصة.
- تشغيل اختبارات واسعة مع إمكانية تشخيص الفشل بدقة.
- ربط كل نتيجة بالـCommit أو Merge Candidate الذي تم اختباره فعلًا.
- تحويل نتائج كثيرة إلى تقرير Canonical واحد قابل للقراءة الآلية والبشرية.
- منع أدوات الإصلاح التلقائي من الكتابة إلا من خلال مسار واحد محكوم.
- منع تقرير نجاح قديم أو يخص Head مختلف من استخدامه كدليل للدمج أو الإغلاق.

تم تحويل هذه المبادئ إلى عقد قابل للقراءة الآلية في:

- `ci-automation.json`
- `contracts/ci-automation.schema.json`

وهذا العقد يكمل:

- `development-automation.json`
- `contracts/development-automation.schema.json`

بحيث يصبح لدينا عقدان مترابطان:

```text
Development Contract
ماذا يجب أن يُنفذ؟ وبأي ترتيب وسلطة وأدلة؟

CI Contract
كيف نثبت أن التنفيذ صحيح، وعلى أي SHA، وما التقرير المعتمد؟
```

---

## 2. المنطق المستخرج من المستودع

### 2.1 CI ليست اختبارًا واحدًا

المستودع يفصل بين طبقات مستقلة:

1. Syntax وStatic Governance.
2. Unit وIntegration Tests.
3. Architecture Drift.
4. Gates متخصصة مثل Spec Completion وWork Maps.
5. E2E Phase Governance.
6. Diagnostic Shards.
7. Canonical Evidence Summary.
8. Trusted PR Evidence Publisher.
9. Generated Artifact Currentness وGoverned Autofix.
10. Release وCompletion Readback.

تطبيق ذلك على مشروعنا يعني ألا ننشئ Workflow واحدة ضخمة فقط، بل Graph من Pipelines لكل واحدة غرض وسلطة وأدلة محددة.

---

### 2.2 الاختبار يجب أن يرتبط بالنسخة التي تم اختبارها

أهم مبدأ هو **Exact Candidate Binding**.

كل تقرير يجب أن يحمل:

- Repository.
- Candidate kind: Head أو Merge Candidate.
- Candidate SHA.
- Source Head SHA.
- Head ref وBase ref.
- Workflow run ID.
- Spec key.
- Task/Wave/Plan Hash عند وجودها.
- `secrets_included=false`.

ويفشل التقرير عند:

- اختلاف SHA الذي تم Checkout له عن SHA المعلن.
- تغير Head الـPR بعد تشغيل الاختبار.
- استخدام نتيجة تخص Branch أو Repository مختلف.
- تعارض نتيجة الـWorkflow مع محتوى التقرير Canonical.
- وجود تقرير أحدث لنفس الـHead.
- احتواء التقرير على Secret أو Payload حساس.

هذا يمنع مشكلة شائعة: نجاح CI على Commit قديم ثم استخدامه للموافقة على Commit جديد.

---

### 2.3 Changed-Scope Fail-Closed

بدل تشغيل كل شيء عشوائيًا أو تجاهل ما لا نفهمه، يتم:

```text
Changed files
→ تصنيف Domain/Test Family
→ معرفة Requirements وTasks المتأثرة
→ تشغيل Gates المطلوبة
→ الفشل إذا كان التغيير غير مصنف
```

العائلات المقترحة للمشروع:

1. Spec Contracts.
2. Evidence State.
3. Intake Authority.
4. File Lifecycle.
5. Gemini Provider.
6. Structured Intelligence.
7. Review & Client Journeys.
8. Semantic & Media.
9. Observability & Recovery.
10. Release & Closeout.

أي ملف جديد لا يقع تحت عائلة معروفة يجب أن يوقف CI بدل تجاهله.

---

### 2.4 الـSpec يحدد الاختبارات المطلوبة

`development-automation.json` يربط كل Task بـ:

- Requirement IDs.
- Acceptance IDs.
- Operation Paths.
- Dependencies.
- Allowed paths.
- Forbidden actions.
- Required tests.
- Required gates.
- Completion evidence.
- Resume key.

بينما `ci-automation.json` يربط Test Families بهذه المتطلبات والمهام.

وبذلك يستطيع النظام أن يقول مثلًا:

```text
T009 — Gemini Gateway

يحتاج:
- Provider contract tests
- Secret boundary tests
- 429/5xx/timeout tests
- Budget policy tests
- Manual fallback tests
- Exact-head CI evidence
```

ولا يعتمد على ذاكرة المطور أو وصف الـPR فقط.

---

## 3. خطوط CI المقترحة

## 3.1 Spec Contract Gate

تعمل عند تغيير:

- ملفات الـSpec.
- العقود والـSchemas.
- Work Maps أو Classification.
- Completion state.
- Workflows المتعلقة بالمشروع.

المراحل:

```text
Checkout exact candidate
→ JSON/YAML/OpenAPI parse
→ Schema validation
→ Cross-reference validation
→ Dependency cycle detection
→ Work Map gate
→ Completion gate
→ No-secret scan
→ Canonical summary
```

هذه الـPipeline مطلوبة حتى للـPRs التي لا تحتوي كود Runtime.

---

## 3.2 Project CI

الـCI العامة للتنفيذ وتشمل:

### Static Governance

- Syntax وType checks.
- Canonical source validation.
- Generated output parity.
- Schema/docs coverage.
- Migration placement.
- Architecture drift.
- Hardcoding ratchets.
- Spec وCI contract gates.

### Unit & Integration

- تثبيت Dependencies من Lockfile.
- تشغيل Changed-Scope tests.
- تشغيل Ordered Full Suite.
- إنتاج Progress Reports حتى عند الفشل.

### Security & Privacy

- Wrong-tenant/Brand/resource.
- Secret boundary.
- Restricted data.
- Prompt injection.
- Provider-disabled/manual fallback.

### Startup & Manifest

- إنشاء Deployment Manifest على الـCandidate نفسه.
- إثبات أن Runtime يبدأ دون Provider فعلي.
- التأكد أن المزايا الجديدة Disabled by default.

---

## 3.3 Phase Governance

هذه الطبقة تربط الـPR بالـTask أو Wave الفعلية.

الخطوات:

1. قراءة `development-automation.json`.
2. تحديد هل الـPR:
   - Task PR.
   - Integration/Convergence PR.
   - Closeout PR.
3. التأكد أن الملفات المعدلة داخل `allowed_paths`.
4. التأكد أن `forbidden_actions` لم تحدث.
5. فحص Dependencies وOpen Decisions وEntry Gates.
6. تشغيل اختبارات المرحلة فقط.
7. إصدار تقرير يحمل:
   - Wave ID.
   - Task ID.
   - Plan hash.
   - Candidate SHA.
   - Evaluation result.
   - Execution result.

هذا يسمح بأتمتة متابعة التطوير دون خلط المهام أو توسيع Scope الـPR.

---

## 3.4 Diagnostic Shards

المستودع لا يكتفي بأن يقول «الاختبارات فشلت»، بل يقسمها إلى Families وShards.

في مشروعنا:

```text
Test family
→ Dynamic matrix
→ Parallel shards
→ Structured report per shard
→ Sequential ordered run
→ Diagnostic summary
→ Exact rerun coordinates
```

مثال نتيجة مفيدة:

```text
Family: structured-intelligence
Shard: 3/6
Failed test: semantic-route-allowlist
Rerun: family=structured-intelligence, parent_index=2, parent_count=6, target_size=1
```

المهم: تقارير التشخيص تساعد على الإصلاح، لكنها ليست وحدها سلطة نجاح الـPR.

---

## 3.5 Canonical Evidence Router

أحيانًا توجد:

- نتيجة Job.
- Artifact من اختبار.
- تقرير تشخيص.
- Workflow conclusion.
- Summary من مرحلة أخرى.

لا يجب أن تكون كلها سلطات متساوية.

الـRouter يقوم بـ:

1. تحميل العقود المعروفة فقط.
2. التحقق من Source Stamps.
3. رفض تقرير Stale أو مجهول.
4. إعطاء الأولوية للتقرير Structured Canonical.
5. مقارنة التقرير مع Workflow conclusion.
6. إنتاج ملخص موحد:
   - Status.
   - Blockers.
   - Counts.
   - Evidence refs.
   - Exact candidate identity.

وبذلك يصبح لدينا **مصدر واحد لحالة CI** بدل تفسير Logs متفرقة.

---

## 3.6 Trusted PR Evidence Publisher

الناشر لا يشغل كودًا من الـPR بصلاحية كتابة.

النمط المقترح:

```text
workflow_run completed
→ Checkout trusted main
→ Download expected canonical artifact
→ Resolve exact PR by repository + head SHA
→ Verify branch when available
→ Verify contract and workflow conclusion
→ Reject stale/superseded/secret reports
→ Sanitize Markdown
→ Upsert one sticky PR comment
```

هذه النقطة مهمة جدًا لأن تشغيل Publisher بصلاحيات كتابة باستخدام كود غير موثوق من Branch قد يفتح مسار Privilege Escalation.

---

## 3.7 Generated Artifact Validation

لو كان المشروع سينتج تلقائيًا:

- خرائط عمليات.
- تقارير عقود.
- نماذج Forms Registry.
- Documentation Catalogs.
- Prompt/Model inventory docs.

فـCI العادية تكون Read-only:

```text
Generator --check
→ لو Current: نجاح
→ لو Stale:
   Generate in isolated tree
   Generate twice to prove idempotency
   Reject files outside generated root
   Build exact-head repair artifact
   remote_write_executed=false
   Fail CI
```

لا تقوم الـValidator بالـCommit أو Push.

---

## 3.8 Governed Sole Writer

في حالة الرغبة في Autofix للملفات المولدة، يكون هناك Writer واحد فقط لكل Artifact Root.

شروطه:

- Explicit one-time authorization.
- PR من نفس المستودع.
- ليس Main.
- Target هو Main.
- Exact expected head SHA.
- إزالة Authorization marker وReadback.
- Generate twice وإثبات Idempotency.
- لا تغيير خارج Root المسموح.
- Commit حقيقي وليس Empty.
- إعادة قراءة Remote head قبل Push.
- Fast-forward فقط.
- ممنوع `--force` و`--force-with-lease`.
- Readback للـPushed SHA.
- Dispatch صريح للـCI والـValidation بعد الكتابة.

هذا يفصل:

```text
Validator: يكتشف ويقترح
Writer: يكتب بعد تفويض
CI: تعيد التحقق من Head الجديد
```

وهو نفس المبدأ المطلوب مع Gemini:

```text
Gemini تقترح
Policy/Human يجيز
Tool محكوم ينفذ
Readback يثبت النتيجة
```

---

## 3.9 Completion Gate

الدمج أو نجاح الاختبارات لا يعني اكتمال المشروع.

بوابة الإغلاق تتحقق من:

- Tasks وChecklists.
- Open Decisions.
- Work Map readiness.
- Implementation PR inventory.
- Exact-head CI.
- Migration checksum وLedger إن وجدت.
- Production/main parity.
- Runtime health وSmoke.
- Queue/Worker state.
- Active Model/Prompt/Policy versions.
- Budget state.
- Manual fallback.
- Rollback rehearsal.
- Post-merge audit.
- Remaining work ownership.

ويجب أن تفصل في التقرير بين:

- Implemented.
- Verified.
- Blocked.
- Deferred with risk.
- Cancelled.
- Unowned — وهذه حالة فشل.

---

## 4. أنواع التقارير

### Diagnostic Evidence

للفهم والتشخيص، مثل:

- Test shard report.
- First failed test.
- Last passed phase.
- Exact rerun coordinates.

لا يستخدم منفردًا كدليل نجاح.

### Canonical Status Evidence

يمثل الحالة المعتمدة للـWorkflow والـCandidate، مثل:

- Spec Contract Summary.
- Project CI Summary.
- Phase Summary.
- Canonical Status Summary.

### Repair Candidate

Artifact يحتوي التعديلات المقترحة فقط، ويؤكد:

- Exact tested SHA.
- Changed files.
- Allowed root.
- Idempotency.
- `remote_write_executed=false`.

### Completion Evidence

يضم:

- PRs.
- CI.
- Migrations.
- Deployment.
- Runtime.
- Rollback.
- Remaining work.

---

## 5. علاقة CI بأتمتة التطوير

المسار الكامل المقترح:

```text
Father Spec
→ Repository Spec Kit
→ development-automation.json
→ Work Map readiness
→ Work Packet for one Task
→ Implementation PR
→ Project CI
→ Phase Governance
→ Diagnostic Shards عند الحاجة
→ Canonical Evidence Router
→ Trusted PR Evidence Publisher
→ Merge
→ Migration/Deployment عبر سلطات منفصلة
→ Production Readback
→ Completion Gate
```

وعند الفشل:

```text
Canonical failure
→ Diagnostic shard coordinates
→ Bounded repair task
→ Same task resume key
→ New exact head
→ Full required CI rerun
```

---

## 6. الحد الأدنى للـMVP

قبل بناء كل الـPipelines، يمكن بدء MVP من خمس طبقات:

1. `spec-contract-gate`
2. `project-ci`
3. `phase-governance`
4. `canonical-evidence-router`
5. `release-completion-gate`

ثم نضيف:

6. Diagnostic Shards.
7. Trusted PR Publisher.
8. Generated Artifact Validator.
9. Governed Writer.

لكن حتى الـMVP يجب أن يحافظ على:

- Exact SHA.
- Structured JSON evidence.
- No-secret.
- Fail-closed.
- No mutation authority from contracts.

---

## 7. ما تم تطبيقه الآن داخل الـSpec

تم إنشاء:

- Machine-readable CI contract.
- Strict JSON Schema.
- عشرة Test Families مرتبطة بالمتطلبات والمهام.
- تسعة Pipelines منطقية.
- ثمانية Evidence Contracts.
- Writer Policy.
- Completion Policy.
- CI Checklist.

لم يتم حتى الآن:

- إنشاء Workflows فعلية داخل `.github/workflows` للمشروع.
- إنشاء Scripts للـValidation أو Evidence Router.
- منح صلاحيات كتابة.
- تشغيل Gemini.
- تطبيق Migration.
- نشر Runtime.

هذه الحدود مقصودة حتى تتم مراجعة العقود أولًا.

---

## 8. قرار التنفيذ المقترح

بعد مراجعة الـSpec، تكون أول حزمة Repository Automation منفصلة:

```text
PR-CI-01
Spec Contract Validator + Cross-reference Linter + Canonical Summary
```

ثم:

```text
PR-CI-02
Phase Governance + Work Packet Scope Gate

PR-CI-03
Dynamic Diagnostic Shards + Ordered Progress Reports

PR-CI-04
Canonical Evidence Router + Trusted PR Publisher

PR-CI-05
Generated Artifact Validator + Authorized Sole Writer

PR-CI-06
Release Completion Gate + Runtime Readback Contracts
```

كل PR منها محدودة، قابلة للاختبار والرجوع، ولا تتضمن تنفيذ Gemini أو عمليات العملاء إلا بعد بواباتها الخاصة.
