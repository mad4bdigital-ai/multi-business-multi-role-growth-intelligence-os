# Spec 014 — Brand-Scoped Commerce Enablement, Retail Operations, WordPress/WooCommerce, Growth, and Workspace Files

## الغرض

تحول هذه الحزمة تجربة RetailOS إلى مواصفة Brownfield داخل **Multi-Business Multi-Role Growth Intelligence OS**، وتساعد كل Tenant وBrand على اكتشاف الإمكانات، مقارنة أنماط تنفيذ، اختيار Solution Blueprint، معرفة الفجوات والاتصالات، توليد خطة محكومة، ومتابعة التشغيل بعد الإطلاق.

تشمل Platform Native وERPNext وWordPress وWooCommerce بأنماطها القياسية والمحكومة والهجينة، إضافة إلى Workspace File Fabric وGoogle Drive.

هذه الحزمة Specification فقط؛ لا تنفذ Provider Calls أو Migrations أو Production Writes.

## Brand هي نطاق التجارة

```text
One Authoritative Writer per Bounded Domain per Brand Scope
```

الـWorkspace حاوية إدارية وتعاونية، لكنها ليست سلطة تجارة كافية. كل Product وStock Unit وReservation وOrder وPOS Sale وPayment وShipment وReturn وPublication وMeasurement Event وCustomer Communication وCommerce File Operation تتطلب Brand دقيقة وBrand Commerce Profile نشطة.

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

يسجل Business Outcome والأنماط والمجالات والاتصالات والـScopes والـGrants والأدوار والموافقات والـPlugins والـLocalization وReadiness Probe وTemplate وRunbook واختبارات القبول والتكلفة والمخاطر.

يفصل بين:

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
- WooCommerce + ERPNext بنمطين للسلطة؛
- Headless WooCommerce؛
- WordPress Content + External Commerce؛
- Existing Store Operational Takeover؛
- Content-led Lead Commerce.

كل Blueprint تحدد Domain Authority Matrix وCapabilities وConnections وCertifications وWorkflows وLaunch Gates وRunbooks وExit Strategy.

## WooCommerce

### Standard Store

WooCommerce يملك المجالات المحددة مثل Catalog وInventory وCheckout وOrders، والمنصة توفر الحوكمة والمحتوى وSEO والقياس والتشغيل والملفات والنمو والتنبيهات والمصالحة.

هذا النمط لا يدعي Atomic Unique-item Reservation بين WooCommerce وPOS وLive.

### Governed Bridge

Bridge Plugin معتمدة تضيف Brand/Site identity وSigned Requests وReplay Protection وIdempotency وExpected Version وReservation/Release/Commit وOperation Ledger وReadback وWebhook Inspection.

### WooCommerce + ERPNext

- WooCommerce authority وERPNext downstream mirror/accounting؛ أو
- ERPNext authority وWooCommerce projection وmediated checkout.

لا يسمح للنظامين بالكتابة في المجال نفسه.

### Adapter tiers

```text
Tier 0 — Discovery only
Tier 1 — Standard REST
Tier 2 — Governed Bridge Plugin
Tier 3 — Certified Extension Profiles
```

تشمل Extension Profiles: Subscriptions وBookings وMemberships وBundles وMultilingual وMulti-currency وMulti-vendor وMulti-location وPayment/Shipping plugins.

## WordPress A–P كقدرات تشغيل

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

كل Pack تدعم Assessment وMigration/Change وContinuous Control.

## Brownfield findings

الريبو يحتوي WordPress A–P وBlog Publishing وCredential Intake Recovery وCMS/Resource Grants وCapability Envelopes وConnector Executor وHosting Inventory وAnalytics وSecurity وBackup وRelease وAudit/Evidence.

لم تثبت المراجعة WooCommerce `wc/v3` Adapter كاملة. كما يجب إصلاح Fuzzy connection selection وLegacy Brand secrets وSite context غير المكتملة وبعض Sheet-primary inventories، مع فصل Inventory/Dry-run عن Certified Apply.

## Brand profiles and connections

Brand Commerce Profile تجمع السياسات والفروع والقنوات وDomain Authorities والدفع والشحن والكتالوجات والقياس وWhatsApp وBrand File Profile.

Brand Site Profile تجمع Brand/Site identity وCanonical hostname وSite role وWordPress/Woo mode والاتصالات الدقيقة وAnalytics bindings وEnvironment topology وRevision وStatus.

الاتصالات:

```text
brand_owned
workspace_delegated
platform_managed
```

لا يوجد Silent Fallback بين Brand وWorkspace وPersonal أو بين البراندات.

## Workspace File Fabric

تدعم Personal وCompany Workspace وBrand File Areas، لكن ملفات التجارة تستخدم Brand File Profile واتصال Brand-owned أو مفوضًا صراحةً.

تشمل List/Search/Read/Export، folders، Multipart/Resumable Upload، Docs/Sheets/Slides، Rename/Move/Copy، Trash/Restore، Permissions، Revisions، Shared Drives، Changes API، Batch Recovery، Manifest وChecksums وReadback.

## Enablement Center وOperations Cockpit

Enablement Center تعرض Goal وBlueprint والبدائل وAuthority Matrix وCapability Map وReadiness وGaps وConnection setup وImplementation Plan وAcceptance Evidence.

Operations Cockpit تعرض Site/Storefront/Checkout health، Orders/Payments/Inventory/Refunds/Fulfillment، Woo Webhooks وScheduled Actions، Outbox/Inbox، WordPress Performance/Security/Errors، Backups، SEO/Analytics/Consent، Feeds، Campaign performance، Incidents وReconciliation.

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
3. Discovery أو Recommendation لا تمنح Authority.
4. Active Plugin لا يثبت Compatibility.
5. Inventory-only لا تعني Apply Support.
6. Woo Standard لا يدعي Atomic Unique-item Reservation بين القنوات.
7. Governed Bridge مطلوبة للـStrict Shared Inventory Invariants.
8. Credentials تأتي من Exact Governed Connection.
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
