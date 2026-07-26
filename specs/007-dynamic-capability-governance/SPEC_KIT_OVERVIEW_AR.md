# نظرة تنفيذية: الحوكمة الديناميكية لكل الأدوات والقدرات

## الهدف

تحويل معالجة الأدوات والقدرات من إصلاحات منفصلة إلى نظام حوكمة موحد وديناميكي يغطي كل الأسطح الحالية والمستقبلية، مع الحفاظ على الفصل بين صلاحيات الأدمن والمستأجر وعدم اعتبار ظهور الأداة تصريحاً بالتنفيذ.

## المشكلة الحالية

المنصة تملك بالفعل سجلات للقدرات، الربط بالمزودين، الأغلفة التنفيذية، سلطة الموارد، الشهادات، أدلة التنفيذ، والديون التشغيلية. لكن التطبيق غير موحد بالكامل:

- بعض عمليات الكتابة تعتمد على tags يدوية.
- بعض الأدوات تُصنف داخل كود خاص باسم الأداة.
- وجود أداة في كتالوج الأدمن قد يُفهم خطأً على أنه إتاحة للمستأجر.
- بعض القدرات مسجلة دون readback أو certification أو resource binding مكتمل.
- توجد مسارات compatibility متعددة قد تشير إلى نفس القدرة.
- اكتشاف الفجوة لا يؤدي دائماً إلى lifecycle موحد للمعالجة والإغلاق.

## الحل المقترح

يبني النظام manifest حوكمة versioned لكل قدرة من مصادر SQL الحالية، ثم يطبق سلسلة قرار واحدة:

```text
هوية المستخدم والتينانت
→ الاسم الدلالي الموحد للقدرة
→ تصنيف الأثر والمخاطر
→ المتطلبات المشتقة
→ سلطة الـworkspace والـresource
→ جاهزية الاتصال والاعتماد
→ الشهادة والـrollout mode
→ الغلاف التنفيذي والموافقة
→ التنفيذ عبر adapter معتمد
→ readback وأدلة وتحديث الدين
```

## المبادئ غير القابلة للتفاوض

1. الأدوات والأسماء والـroutes مجرد aliases وليست سلطة أمنية.
2. أي غموض أو نقص في التصنيف أو السياسة يغلق التنفيذ.
3. المستأجر لا يرث أدوات الأدمن، بل يحصل على facade محدود مشتق من قدرة tenant-safe.
4. الاتصال `pending_validation` أو المنتهي أو الملغي لا يستخدم للتنفيذ.
5. كل mutation لها policy صريحة، ونطاق مورد، وتدقيق، وreadback.
6. نجاح HTTP لا يساوي نجاحاً متحققاً؛ readback هو دليل الحالة النهائية.
7. الشهادات versioned وتنتهي أو تصبح stale عند تغير الكود أو العقد أو المزود.
8. لا يتم تفعيل كل القدرات تلقائياً؛ التوسع يتم capability-by-capability وcohort-by-cohort.
9. الأدلة لا تحتوي أسراراً، ولا تنسخ credentials بين الطبقات.
10. التراجع لا يحذف سجل القرار أو التنفيذ.

## ما يعاد استخدامه

- `platform_plugin_capabilities` كالرسم البياني canonical للقدرات.
- `platform_semantic_capabilities` كمصدر دلالي compatibility مرتبط بالهوية canonical.
- `platform_capability_provider_bindings` و`platform_tool_dispatch_bindings` للربط بالتنفيذ.
- `execution_policies` كسلطة انتقالية و`platform_engine_policy_rules` كهدف نهائي.
- `capability_resolution_envelope_ledger` للأغلفة المرتبطة بكل طلب.
- سجلات سلطة الموارد والشهادات والأدلة والديون الحالية.
- جداول Admin/Tenant tools كـprojections وليست authority مستقلة.

## المخرجات الأساسية

- Capability Governance Compiler.
- Manifest ثابت وقابل للتدقيق لكل قدرة.
- مصنف effect/risk ديناميكي.
- Requirement compiler يحدد approval وreadback وcertification وغيرها.
- Shared Enforcement Kernel لكل الأدوات والقدرات.
- Admin وTenant projections مشتقة وآمنة.
- Adapter contract موحد وشهادة versioned.
- Readback contracts عامة.
- Reconciliation وcapability debt lifecycle.
- Operational alerts مبنية على نفس reason codes والفجوات.

## التطبيق على الحالات الحالية

### التنبيهات التشغيلية

تُعامل المزامنة وتحديث lifecycle كقدرات internal-write، مع غلاف تنفيذي، typed confirmation، audit، وsame-cycle row readback. لا نضيف استثناءاً يدوياً لكل أداة.

### WordPress

تُفصل القدرات إلى validation وread وcreate_draft وpublish وغيرها. كل قدرة تحصل على متطلبات مختلفة. التحقق من الاتصال لا يساوي النشر، وإنشاء Draft لا يمنح publish authority.

### بقية المزودين

GitHub وCloudflare وHostinger وn8n وGoogle Ads والـlocal connectors تستخدم نفس نموذج الهوية والسياسة والشهادة والـreadback، مع adapters متخصصة فقط في النقل وترجمة العقد.

## التسليم

الـSpec Kit نفسه يُنشأ في PR واحد. التنفيذ `multi_pr` إلزامي لأن النظام يحتاج migrations additive، shadow parity، canary، production verification، وpost-merge audit. لا يوجد global cutover، ولا يتم تشغيل provider mutation في PR المواصفة.
