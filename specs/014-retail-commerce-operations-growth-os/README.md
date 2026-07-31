# Spec 014 — Brand-Scoped Commerce Enablement, Retail Operations, WordPress/WooCommerce, Growth, and Workspace Files

## الغرض

تحول هذه الحزمة تجربة RetailOS إلى مواصفة Brownfield قابلة للتنفيذ داخل منصة **Multi-Business Multi-Role Growth Intelligence OS**، وتوسعها بحيث لا تقدم المنصة نظام تجارة واحدًا فقط؛ بل تساعد كل Tenant وBrand على:

- اكتشاف الإمكانات المتاحة فعليًا داخل المنصة والأنظمة المتصلة؛
- تشخيص وضع الموقع والمتجر والتشغيل الحالي؛
- مقارنة أنماط تنفيذ متعددة؛
- اختيار Solution Blueprint مناسبة؛
- معرفة الفجوات والاتصالات والإضافات والموافقات المطلوبة؛
- توليد خطة تنفيذ محكومة؛
- متابعة المتجر والعمليات والموقع والقياس بعد الإطلاق.

تشمل الأنماط المخططة Platform Native وERPNext وWordPress وWooCommerce بأنماطها القياسية والمحكومة والهجينة، إلى جانب Workspace File Fabric وGoogle Drive.

هذه الحزمة Specification فقط. لا تدعي أن Commerce أو WooCommerce أو File Management مكتملة في Runtime، ولا تنفذ Provider Calls أو Migrations أو Production Writes.

## القاعدة الحاكمة: التجارة مرتبطة بالبراند

الـWorkspace حاوية إدارية وتعاونية، لكنها لا تكفي وحدها كسلطة تجارة إلكترونية.

```text
One Authoritative Writer per Bounded Domain per Brand Scope
مصدر كتابة واحد لكل مجال محدود داخل نطاق براند محدد
```

كل Product وStock Unit وReservation وOrder وPOS Sale وPayment وShipment وReturn وPublication وMeasurement Event وCustomer Communication وCommerce File Operation تتطلب `brand_ref` دقيقة وBrand Commerce Profile نشطة.

أي صياغة أقدم تعامل Brand كاختيارية أو تجعل Workspace وحدها سلطة تجارة تعد معدلة بواسطة `brand-scoped-commerce-authority.md`.

## Commerce Enablement Fabric

المنصة المستهدفة لا تعرض للمستخدم قائمة Connectors تقنية فقط. بل تدير المسار التالي:

```text
Tenant
→ Workspace
→ Brand
→ Business Goal
→ Existing Assets and Connections
→ Capability Graph
→ Candidate Solution Blueprints
→ Readiness / Gaps / Risks / Cost
→ Governed Implementation Plan
→ Launch Gates
→ Operations Cockpit
```

### Capability Catalog

يسجل كتالوج الإمكانات لكل Capability:

- النتيجة التجارية التي تحققها؛
- الأنماط التي تدعمها؛
- مجالات السلطة المطلوبة؛
- الاتصالات والـScopes والـResource Grants؛
- الأدوار والموافقات؛
- الـProvider أو Plugin أو Localization المطلوبة؛
- Implementation Maturity؛
- Readiness Probe؛
- Implementation Template؛
- Runbook واختبارات القبول والتكلفة والمخاطر.

ويفرق بوضوح بين:

```text
inventory_only
dry_run_ready
apply_supported
sandbox_certified
production_certified
```

وجود Inventory Function لا يعني أن المنصة قادرة على تطبيق Mutation إنتاجية.

## Solution Blueprints

### Platform Native Commerce

المنصة تملك Catalog وInventory وReservations وOrders وPOS وReturns، وتستخدم Adapters للدفع والشحن والأنظمة الخارجية.

### ERPNext Commerce Authority

ERPNext/Frappe يملك المجالات المحددة، والمنصة توفر التجربة والحوكمة والقياس والملفات والنمو، مع Frappe App معتمدة عند الحاجة إلى حجز ذري أو قطع فريدة.

### WooCommerce Standard Brand Store

WooCommerce يملك Catalog وInventory وCheckout وOrders وCoupons في النطاق المحدد، بينما تستخدم المنصة قدراتها الحالية في:

- الموقع والمحتوى وSEO؛
- Analytics وConsent؛
- التشغيل والمراقبة؛
- الملفات والوسائط؛
- Growth Intelligence؛
- التنبيهات والمصالحة.

هذا النمط لا يدعي حماية ذرية لقطعة فريدة بين WooCommerce وPOS وLive دون Bridge معتمدة.

### WooCommerce Governed Bridge

WooCommerce يبقى واجهة المتجر والـCheckout، وتضيف Bridge Plugin معتمدة:

- Brand وSite identity؛
- Signed requests وReplay protection؛
- Idempotency وExpected Version؛
- Reservation/Release/Commit؛
- Operation Ledger وReadback؛
- Webhook delivery inspection؛
- Unique-item and cross-channel guarantees.

### WooCommerce + ERPNext

يدعم Variantين صريحين:

1. WooCommerce يملك Orders/Inventory وERPNext Mirror/Accounting downstream.
2. ERPNext يملك Catalog/Inventory/Orders وWooCommerce Projection وCheckout Mediated عبر Bridge.

لا يسمح للنظامين بالكتابة في نفس المجال.

### Headless WooCommerce

WooCommerce يوفر Commerce APIs، بينما تقدم المنصة أو Frontend أخرى تجربة المتجر، مع عقود واضحة للجلسة والسلة والـCheckout والـSEO والـCache والـWebhooks.

### WordPress Content + External Commerce

WordPress يملك المحتوى والـBuilders والنماذج وSEO، بينما تملك Platform Native أو ERPNext أو Backend أخرى التجارة. المنتجات المعروضة في WordPress Projections وليست سلطة مخزون خفية.

### Existing Store Operational Takeover

لمتجر WordPress/WooCommerce موجود: تبدأ المنصة بالاكتشاف والـRead-only Monitoring ثم تفعّل القدرات تدريجيًا بعد الاعتماد.

### Content-led Lead Commerce

للخدمات والـLead Generation: WordPress + Forms + CRM + WhatsApp + Attribution + optional Payment Links من دون فرض Inventory Ledger غير مطلوبة.

## إعادة استخدام WordPress A–P

المراجعة أثبتت وجود Lifecycle Engine كبيرة تحت `http-generic-api/wordpress/`، وتصدر `index.js` المراحل A إلى P.

سيعاد تقديمها كـSite Lifecycle Capability Packs:

| المرحلة | Capability Pack |
|---|---|
| A | Content Foundation — Posts/Pages/Taxonomies/Draft-first/Reference Repair |
| B | Builder and Theme Assets — Elementor/Templates/Navigation/Dependencies |
| C | Site Configuration — Permalinks/Language/Timezone/Theme/Reading/Writing |
| D | Forms and Integrations — CF7/WPForms/Fluent Forms/Gravity/Elementor Forms |
| E | Media and Attachments — Featured/Inline/Orphan Media |
| F | Users, Roles, and Authentication |
| G | SEO, Metadata, Taxonomies, and Redirects |
| H | GA/GTM/Meta/TikTok/Custom Tracking and Consent |
| I | Cache/CDN/Assets/Images/Lazyload Performance |
| J | TLS/Headers/WAF/Hardening/Exposed Surfaces |
| K | Logging/Alerts/Errors/Uptime/Monitoring |
| L | Backup, Recovery Points, and Retention |
| M | Release, Maintenance Window, Cache Flush, and Rollback |
| N | Data Integrity, Drift, and Reconciliation |
| O | Smoke/Content/Forms/SEO/Analytics Acceptance |
| P | DNS/TLS/CDN/Monitoring Handoff and Production Cutover |

كل Pack يجب أن يدعم بصورة صريحة:

```text
assessment
migration_or_change
continuous_control
```

وبذلك تتحول قدرات Migration الحالية إلى أدوات تشغيل مستمرة بدل استخدامها مرة واحدة فقط.

## WordPress وWooCommerce في الكود الحالي

توجد بالفعل قدرات قابلة لإعادة الاستخدام:

- WordPress plan/gate/inventory/normalization/dry-run/operator-handoff patterns؛
- WordPress blog publishing مع Credential Intake Recovery؛
- CMS Site Access Grants؛
- Workspace Resource Grants؛
- Capability Resolution Envelopes؛
- Connector Executor وتسجيل Workflow/Step/Telemetry/Audit؛
- Hosting and Site Runtime Inventory؛
- Analytics/Consent/Performance/Security/Backup/Release tooling.

لكن المراجعة لم تثبت WooCommerce REST Adapter كاملة لـ`wc/v3`. وجود WooCommerce أو Facebook for WooCommerce كـPlugin Signal لا يثبت جاهزية Product/Stock/Order/Refund/Webhook operations.

كما توجد فجوات Legacy يجب علاجها:

- Fuzzy connected-system selection؛
- بعض أسرار/إعدادات WordPress داخل Brand rows قديمة؛
- Site context غير مكتملة كـBrand Site Profile؛
- بعض مراحل التشغيل ما زالت مرتبطة بـGoogle Sheets inventories بدل SQL-primary runtime؛
- Inventory/Dry-run أكثر نضجًا من Certified Apply paths.

## WooCommerce Capability Packs

ستضاف Packs متخصصة:

1. Store and System Profile؛
2. Product and Variation Catalog؛
3. Inventory and Reservation؛
4. Checkout, Orders, Customers, and Coupons؛
5. Payments, Refunds, and Disputes؛
6. Fulfillment, Shipping, Pickup, and Tracking؛
7. Webhooks and Provider Inbox؛
8. Extension and Compatibility Profiles؛
9. Operational Health؛
10. Release and Change Governance.

### Adapter Tiers

```text
Tier 0 — Discovery only
Tier 1 — WooCommerce Standard REST
Tier 2 — Governed Bridge Plugin
Tier 3 — Certified Extension Profiles
```

Tier 3 يغطي بصورة منفصلة Subscriptions وBookings وMemberships وBundles وMultilingual وMulti-currency وMulti-vendor وMulti-location وPayment/Shipping plugins.

الإضافة النشطة لا تعتبر آمنة تلقائيًا، بل تصنف:

```text
certified
compatible
compatible_with_constraints
requires_mapping_profile
conflicting
unsupported
unknown
```

## Brand Commerce Profile وBrand Site Profile

### Brand Commerce Profile

يجمع العملة واللغة والسياسات والفروع والقنوات وDomain Authorities والدفع والشحن والكتالوجات والقياس وWhatsApp وBrand File Profile.

### Brand Site Profile

يجمع:

- Brand وSite identity؛
- Canonical hostname وSite role؛
- WordPress/WooCommerce mode؛
- WordPress وWooCommerce وHosting وCDN/DNS/Security connections؛
- Analytics bindings؛
- Staging/Development/Production topology؛
- Profile revision وStatus.

لا يستخدم Domain أو WordPress ID أو Woo ID كسلطة.

## اتصالات البراند

الاتصال يكون:

```text
brand_owned
workspace_delegated
platform_managed
```

الاتصال المملوك للـWorkspace لا يصبح متاحًا للبراند تلقائيًا. يلزم تفويض صريح يحدد Brand وDomain وCapability وConnection وPolicy Revision والمدة.

لا يوجد Silent Fallback:

```text
Brand → Workspace
Brand → Personal
Brand A → Brand B
Inactive Brand → Default Brand
```

## Workspace File Fabric وGoogle Drive

تدعم Personal وCompany Workspace وBrand File Areas، لكن ملفات التجارة تستخدم Brand File Profile واتصال Brand-owned أو مفوضًا صراحةً.

القدرات تشمل List/Search/Read/Export، إنشاء المجلدات، Multipart/Resumable Upload، Docs/Sheets/Slides، Rename/Move/Copy، Trash/Restore، Permissions، Revisions، Shared Drives، Changes API، Batch Recovery، Manifest وChecksums وReadback.

المسار المرجعي:

```text
Resolve Brand File Profile
→ Resolve Brand Drive Connection and Root
→ Create Child and Categorized Folders
→ Upload with Checksums and Idempotency
→ Archive Historical Copies
→ Generate Brand Manifest
→ Read Back Names / MIME / Parents / Sizes / Counts / Brand Binding
→ Resume Failed Items without Duplicating Completed Writes
```

## Enablement Center

واجهة Brand-scoped داخل Unified Platform تعرض:

- Goal and Blueprint؛
- البدائل والمفاضلات؛
- Domain Authority Matrix؛
- Capability Map؛
- Readiness وDependency-ordered Gaps؛
- Connection and Authorization setup؛
- Durable Implementation Plan؛
- Acceptance Evidence؛
- Progress and Handoff.

## Operations Cockpit

بعد الإطلاق تعرض:

- Site وStorefront وCheckout health؛
- Orders وPayments وInventory وRefunds وFulfillment؛
- Woo Webhooks وScheduled Actions؛
- Outbox/Inbox lag؛
- WordPress errors وPerformance وSecurity؛
- Backup freshness وRestore readiness؛
- SEO وAnalytics وConsent coverage؛
- Feeds وCatalog rejection؛
- Campaign performance وContribution؛
- Incidents وApprovals وReconciliation tasks.

كل Recommended Action توضح Business impact وEvidence وAutomation level وAuthority وConnection وApproval وRollback وReadback والتكلفة والمخاطر.

## الأدوار

- Brand Owner؛
- Ecommerce Manager؛
- Marketing Manager؛
- Operations Manager؛
- Site Administrator؛
- Agency/Delegated Operator؛
- Platform Administrator.

كل دور يرى القدرات والعمليات التي يملك Authority عليها فقط.

## الوثائق الرئيسية

| الملف | الغرض |
|---|---|
| `spec.md` | المتطلبات الأساسية |
| `brand-scoped-commerce-authority.md` | Brand Commerce Authority الإلزامية |
| `commerce-enablement-and-solution-blueprints.md` | Capability Catalog وDiscovery وBlueprints وEnablement Center |
| `wordpress-woocommerce-authority-and-operations.md` | مراجعة WordPress A–P وعقود WooCommerce والـBridge |
| `external-system-and-workspace-file-fabric.md` | معمار التكاملات وGoogle Drive |
| `adapter-certification.md` | اعتماد الـAdapters |
| `commerce-enablement-acceptance.md` | 80 اختبار قبول للتمكين وWordPress/WooCommerce |
| `commerce-enablement-tasks.md` | مراحل التنفيذ CE-0 إلى CE-19 |
| `brand-commerce-acceptance.md` | اختبارات Brand isolation |
| `brand-commerce-tasks.md` | مهام Brand Profile والاتصالات والترحيل |
| `external-integration-and-drive-acceptance.md` | اختبارات التكامل وإدارة الملفات |
| `contracts/commerce-capability-catalog.schema.json` | Capability/Blueprint/Discovery contracts |
| `contracts/wordpress-woocommerce-adapter.schema.json` | WordPress/Woo adapter and certification contract |
| `contracts/brand-commerce-context.schema.json` | Brand Commerce Context |
| `contracts/commerce-provider-adapter.schema.json` | Commerce Authority Adapter، ويشمل WooCommerce |
| `contracts/workspace-files.openapi.yaml` | Workspace File APIs |
| `checklists/commerce-enablement-and-wordpress.md` | بوابة مراجعة التمكين وWordPress/WooCommerce |
| `completion.json` | حالة دورة الحياة وأدلة الإغلاق |

## مبادئ غير قابلة للتفاوض

1. Brand إلزامية لكل تجارة.
2. مصدر كتابة واحد لكل Domain داخل Brand scope.
3. Capability Discovery أو Blueprint Recommendation لا تمنح Authority.
4. لا Route أو UI أو Agent يختار Provider أو Connection مباشرة.
5. Active Plugin لا يثبت Safety أو Compatibility.
6. Inventory-only لا تعني Apply Support.
7. Woo Standard لا يدعي Atomic Unique-item Reservation بين القنوات.
8. Governed Bridge مطلوبة عند مشاركة Strict Inventory Invariants.
9. WordPress/Woo credentials تأتي من Exact Governed Connection.
10. Webhooks تدخل Provider Webhook Inbox.
11. Unknown outcome لا يعاد قبل Readback.
12. كل Launch تشمل Backup وRollback وQA وObservability وReconciliation.
13. WordPress A–P يعاد استخدامها ولا يبنى Framework مكرر.
14. UI وAgents وAPIs تستخدم Application Services والAuthority نفسها.
15. Personal Drive لا تصبح سلطة ملفات Brand.
16. Credentials وRaw Payloads وPrivate Content لا تدخل Logs أو Evidence أو Agent Context.
17. Documentation أو Demo أو Mock لا تثبت Production readiness.

## حالة الحزمة

- Specification only.
- Runtime implementation لم يبدأ.
- لا توجد Migrations مطبقة.
- لا توجد WordPress أو WooCommerce أو Google Drive mutations.
- لا توجد Provider Calls أو Payment/Refund/Catalog writes.
- لا يوجد DNS أو Production Cutover.
- لا توجد Secrets.
- التنفيذ مخطط كحزمة Multi-PR مستقلة ومحكومة.
