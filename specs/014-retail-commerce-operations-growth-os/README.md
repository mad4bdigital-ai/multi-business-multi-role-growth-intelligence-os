# Spec 014 — Brand-Scoped Commerce Enablement, Retail Operations, WordPress/WooCommerce, Growth, and Workspace Files

## الغرض

تحول هذه الحزمة تجربة RetailOS إلى مواصفة Brownfield قابلة للتنفيذ داخل منصة **Multi-Business Multi-Role Growth Intelligence OS**، وتوسعها بحيث تساعد كل Tenant وBrand على اكتشاف الإمكانات المتاحة، مقارنة أنماط تنفيذ متعددة، اختيار Solution Blueprint، معرفة الفجوات والاتصالات والموافقات، توليد خطة تنفيذ محكومة، ومتابعة التشغيل بعد الإطلاق.

تشمل الأنماط المخططة Platform Native وERPNext وWordPress وWooCommerce بأنماطها القياسية والمحكومة والهجينة، إلى جانب Workspace File Fabric وGoogle Drive.

هذه الحزمة Specification فقط. لا تنفذ Provider Calls أو Migrations أو Production Writes.

## Brand هي نطاق التجارة الإلزامي

```text
One Authoritative Writer per Bounded Domain per Brand Scope
```

الـWorkspace حاوية إدارية وتعاونية، لكنها لا تكفي وحدها كسلطة تجارة. كل Product وStock Unit وReservation وOrder وPOS Sale وPayment وShipment وReturn وPublication وMeasurement Event وCustomer Communication وCommerce File Operation تتطلب Brand دقيقة وBrand Commerce Profile نشطة.

## Commerce Enablement Fabric

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

يسجل النتيجة التجارية، الأنماط المدعومة، المجالات والاتصالات والـScopes والـGrants والأدوار والموافقات والـPlugins والـLocalization، بالإضافة إلى Readiness Probe وTemplate وRunbook واختبارات القبول والتكلفة والمخاطر.

ويفصل بين:

```text
inventory_only
dry_run_ready
apply_supported
sandbox_certified
production_certified
```

وجود Inventory Function لا يعني Apply Support.

## Solution Blueprints

- Platform Native Commerce؛
- ERPNext Commerce Authority؛
- WooCommerce Standard Brand Store؛
- WooCommerce Governed Bridge؛
- WooCommerce + ERPNext بنمطين واضحين للسلطة؛
- Headless WooCommerce؛
- WordPress Content + External Commerce؛
- Existing Store Operational Takeover؛
- Content-led Lead Commerce.

كل Blueprint تحدد Domain Authority Matrix وCapabilities وConnections وCertifications وWorkflows وLaunch Gates وRunbooks وExit Strategy.

## WooCommerce

### Standard Brand Store

WooCommerce يملك Catalog وInventory وCheckout وOrders وCoupons في النطاق المحدد. المنصة توفر الحوكمة، الموقع والمحتوى وSEO، Analytics وConsent، التشغيل والمراقبة، الملفات والوسائط، Growth Intelligence، التنبيهات والمصالحة.

هذا النمط لا يدعي Atomic Unique-item Reservation بين WooCommerce وPOS وLive.

### Governed Bridge

Bridge Plugin معتمدة تضيف Brand/Site identity، Signed Requests، Replay Protection، Idempotency، Expected Version، Reservation/Release/Commit، Operation Ledger، Readback، Webhook Inspection، وحماية القطعة الفريدة بين القنوات.

### WooCommerce + ERPNext

1. WooCommerce يملك Orders/Inventory وERPNext Mirror/Accounting downstream.
2. ERPNext يملك Catalog/Inventory/Orders وWooCommerce Projection وCheckout Mediated عبر Bridge.

لا يسمح للنظامين بالكتابة في نفس المجال.

### Adapter tiers

```text
Tier 0 — Discovery only
Tier 1 — Standard REST
Tier 2 — Governed Bridge Plugin
Tier 3 — Certified Extension Profiles
```

تشمل Extension Profiles: Subscriptions وBookings وMemberships وBundles وMultilingual وMulti-currency وMulti-vendor وMulti-location وPayment/Shipping plugins.

## إعادة استخدام WordPress A–P

المراحل الحالية تصبح Site Lifecycle Capability Packs:

| المرحلة | Capability Pack |
|---|---|
| A | Content Foundation |
| B | Builder and Theme Assets |
| C | Site Configuration |
| D | Forms and Integrations |
| E | Media and Attachments |
| F | Users, Roles, and Authentication |
| G | SEO and Redirects |
| H | Analytics and Consent |
| I | Performance |
| J | Security |
| K | Observability |
| L | Backup and Recovery |
| M | Release and Rollback |
| N | Data Integrity and Reconciliation |
| O | QA and Acceptance |
| P | Production Cutover |

كل Pack تدعم بصورة صريحة Assessment وMigration/Change وContinuous Control.

## Brownfield findings

يحتوي الريبو بالفعل على WordPress A–P، Blog Publishing، Credential Intake Recovery، CMS Site Grants، Workspace Resource Grants، Capability Envelopes، Connector Executor، Hosting Inventory، Analytics، Security، Backup، Release، Audit وEvidence.

لكن المراجعة لم تثبت WooCommerce `wc/v3` Adapter كاملة. كما يجب علاج Fuzzy connection selection، Legacy Brand secrets، Site context غير المكتملة، وبعض Sheet-primary inventories، والفصل بين Inventory/Dry-run وCertified Apply.

## Brand Commerce Profile وBrand Site Profile

Brand Commerce Profile تجمع السياسات والفروع والقنوات وDomain Authorities والدفع والشحن والكتالوجات والقياس وWhatsApp وBrand File Profile.

Brand Site Profile تجمع Brand/Site identity، Canonical hostname، Site role، WordPress/WooCommerce mode، الاتصالات الدقيقة، Analytics bindings، Staging/Production topology، Revision وStatus.

## الاتصالات

```text
brand_owned
workspace_delegated
platform_managed
```

لا يوجد Silent Fallback من Brand إلى Workspace أو Personal أو Brand أخرى. IDs القادمة من العميل Constraints فقط.

## Workspace File Fabric وGoogle Drive

تدعم Personal وCompany Workspace وBrand File Areas، لكن ملفات التجارة تستخدم Brand File Profile واتصال Brand-owned أو مفوضًا صراحةً.

تشمل List/Search/Read/Export، folders، Multipart/Resumable Upload، Docs/Sheets/Slides، Rename/Move/Copy، Trash/Restore، Permissions، Revisions، Shared Drives، Changes API، Batch Recovery، Manifest، Checksums وReadback.

## Enablement Center

واجهة Brand-scoped تعرض Goal وBlueprint، البدائل، Domain Authority Matrix، Capability Map، Readiness، Dependency-ordered gaps، Connection setup، Durable Implementation Plan، Acceptance Evidence والتقدم.

## Operations Cockpit

تعرض Site/Storefront/Checkout health، Orders/Payments/Inventory/Refunds/Fulfillment، Woo Webhooks وScheduled Actions، Outbox/Inbox، WordPress errors/Performance/Security، Backups، SEO/Analytics/Consent، Feeds، Campaign performance، Incidents وReconciliation.

## الوثائق الرئيسية

- `brand-scoped-commerce-authority.md`
- `commerce-enablement-and-solution-blueprints.md`
- `wordpress-woocommerce-authority-and-operations.md`
- `external-system-and-workspace-file-fabric.md`
- `adapter-certification.md`
- `commerce-enablement-acceptance.md`
- `commerce-enablement-tasks.md`
- `contracts/commerce-capability-catalog.schema.json`
- `contracts/wordpress-woocommerce-adapter.schema.json`
- `contracts/commerce-provider-adapter.schema.json`
- `checklists/commerce-enablement-and-wordpress.md`
- `completion.json`

## مبادئ غير قابلة للتفاوض

1. Brand إلزامية لكل تجارة.
2. مصدر كتابة واحد لكل Domain داخل Brand.
3. Capability Discovery أو Blueprint Recommendation لا تمنح Authority.
4. Active Plugin لا يثبت Compatibility.
5. Inventory-only لا تعني Apply Support.
6. Woo Standard لا يدعي Atomic Unique-item Reservation بين القنوات.
7. Governed Bridge مطلوبة عند مشاركة Strict Inventory Invariants.
8. WordPress/Woo credentials تأتي من Exact Governed Connection.
9. Webhooks تدخل Provider Webhook Inbox.
10. Unknown outcome لا يعاد قبل Readback.
11. كل Launch تشمل Backup وRollback وQA وObservability وReconciliation.
12. WordPress A–P يعاد استخدامها ولا يبنى Framework مكرر.
13. UI وAgents وAPIs تستخدم Authority/Application Services نفسها.
14. Personal Drive لا تصبح سلطة ملفات Brand.
15. Documentation أو Demo أو Mock لا تثبت Production readiness.

## حالة الحزمة

- Specification only.
- Runtime implementation لم يبدأ.
- لا توجد Migrations مطبقة.
- لا توجد WordPress أو WooCommerce أو Google Drive mutations.
- لا توجد Provider Calls أو DNS أو Production Cutover.
- لا توجد Secrets.
