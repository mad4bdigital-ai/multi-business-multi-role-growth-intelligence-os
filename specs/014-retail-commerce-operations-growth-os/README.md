# Spec 014 — Dynamic Business-Profile-Driven Commerce Enablement, Retail Operations, WordPress/WooCommerce, Growth, and Workspace Files

تعرّف هذه الحزمة معمارًا يمكّن كل Tenant وBrand من اكتشاف قدرات المنصة والأنظمة المتصلة، مقارنة حلول التجارة الإلكترونية، اختيار Blueprint مناسبة، تنفيذها بخطة محكومة، ومتابعة التشغيل بعد الإطلاق.

لا يبدأ الاختيار من اسم Provider أو CMS فقط. يبدأ من **نوع النشاط التجاري وBusiness Operating Profile الفعلية**، ثم يحسم القدرات والقيود والأنظمة المناسبة بصورة ديناميكية وقابلة للوراثة.

تشمل الأنماط Platform Native وERPNext وWordPress/WooCommerce القياسية والمحكومة والهجينة، إضافة إلى Google Drive وWorkspace File Fabric.

```text
Platform Policy
→ Tenant Business Operating Profile
→ Workspace Operating Defaults
→ Primary / Secondary Business Activities
→ Activity Capability Packs
→ Brand Business Profile
→ Brand Commerce Profile
→ Channel / Location Overlay
→ Effective Capability Graph
→ Solution Blueprints
→ Readiness and Gaps
→ Implementation Plan
→ Launch Gates
→ Operations Cockpit
```

## الفصل بين الملفات التعريفية

- `commercial_profiles` الحالية تظل خاصة بالعلاقة التجارية مع المستأجر: الخطة، العقد، MRR، LTV، Health وChurn.
- Business Operating Profile تصف ما يفعله النشاط وكيف يعمل وما يحتاجه من قدرات.
- Brand Commerce Profile تحسم الاتصالات والسلطات والقنوات والفروع والسياسات التجارية للبراند.
- إجابات `/connect` و`industry` و`verticals_json` أدلة Discovery ومرشحات، وليست Runtime Authority مباشرة.

## مبادئ حاكمة

- Brand إلزامية لكل تجارة.
- مصدر كتابة واحد لكل Domain داخل Brand.
- Business Activity Type وActivity Packs مسجلة وقابلة للإصدار، وليست شروطًا Hardcoded داخل الكود.
- النشاط يدعم Primary وSecondary وCross-cutting Packs.
- الوراثة تعيد استخدام Dynamic Container Authority وSpec 011/012.
- كل Dimension لها Merge Strategy مستقلة؛ لا يوجد Generic Deep Merge.
- `deny_wins` للمنع، `union` للمتطلبات، `intersection` للمسموح، `nearest_replace` للإعدادات، و`block_on_conflict` للسلطات الحرجة.
- كل Effective Value تحمل Lineage وRevision Vector.
- Stale Effective Business Profile تفشل مغلقًا في الكتابات المؤثرة.
- Discovery وRecommendation لا تمنح Authority.
- Availability منفصلة عن Implementation Maturity.
- WordPress A–P يعاد استخدامها كـLifecycle Capability Packs.
- Active Plugin لا يثبت Compatibility.
- Woo Standard لا يثبت Atomic Unique-item Safety بين القنوات.
- Governed Bridge مطلوبة للـStrict Shared Inventory Invariants.
- Exact Brand Connections وWebhook Inbox وReadback وCertification إلزامية.
- كل Launch تشمل Backup وRollback وQA وObservability وReconciliation.
- UI والـAgents والـAPIs تستخدم نفس Effective Business Profile ونفس Application Services.

## الأنماط الأساسية

- Platform Native Commerce؛
- ERPNext Commerce Authority؛
- WooCommerce Standard Brand Store؛
- WooCommerce Governed Bridge؛
- WooCommerce + ERPNext؛
- Headless WooCommerce؛
- WordPress Content + External Commerce؛
- Existing Store Operational Takeover؛
- Content-led Lead Commerce.

اختيار النمط يتم من Business Profile والقدرات الفعلية والاتصالات واعتماد الـAdapters، وليس من اختيار يدوي غير محكوم.

## الوثائق المعيارية

- `business-activity-profile-and-inheritance.md`
- `brand-scoped-commerce-authority.md`
- `commerce-enablement-and-solution-blueprints.md`
- `wordpress-woocommerce-authority-and-operations.md`
- `external-system-and-workspace-file-fabric.md`
- `adapter-certification.md`
- `business-activity-inheritance-acceptance.md`
- `business-activity-inheritance-tasks.md`
- `commerce-enablement-acceptance.md`
- `commerce-enablement-tasks.md`
- `contracts/business-activity-profile-inheritance.schema.json`
- `contracts/commerce-capability-catalog.schema.json`
- `contracts/wordpress-woocommerce-adapter.schema.json`
- `contracts/commerce-provider-adapter.schema.json`
- `checklists/business-activity-inheritance.md`

هذه PR مواصفة فقط. لم يحدث Runtime أو Database أو Provider أو WordPress أو WooCommerce أو Google Drive أو DNS أو Payment أو Catalog أو Production mutation، ولا تحتوي Secrets.
