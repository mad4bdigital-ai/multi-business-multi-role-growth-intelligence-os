# Commerce Enablement and WordPress/WooCommerce Acceptance Matrix

| ID | Capability | Required evidence | Failure that must be detected |
|---|---|---|---|
| CEA-001 | Brand discovery | Discovery result binds one Tenant, Workspace, Brand, and Brand profile revision | Workspace-only or null Brand discovery accepted |
| CEA-002 | Capability catalog | Versioned catalog returns user-facing capability, maturity, requirements, and runbook | Raw technical actions shown without business capability mapping |
| CEA-003 | Maturity honesty | Inventory-only implementation is labeled inventory-only | Inventory function advertised as executable production mutation |
| CEA-004 | Blueprint registry | Blueprint defines authority matrix, capabilities, connections, gates, and exit strategy | Blueprint exists as label without execution contract |
| CEA-005 | Blueprint recommendation | Deterministic evidence-backed score and reasons | AI-only unsupported recommendation |
| CEA-006 | Multiple alternatives | Compatible alternatives and tradeoffs returned | One provider forced without explanation |
| CEA-007 | Authority validation | Exactly one writer per domain per Brand | Two writable systems accepted for same domain |
| CEA-008 | Brand profile readiness | Missing Brand fields become ordered blockers | Implicit default values authorize execution |
| CEA-009 | Connection discovery | Exact Brand-owned/delegated connection status shown | First or fuzzy connection selected |
| CEA-010 | Capability dependency graph | Blockers ordered by dependencies | User asked to configure downstream capability first |
| CEA-011 | Existing asset reuse | Existing verified capabilities reduce required work | Platform proposes duplicate replacement without evidence |
| CEA-012 | External purchase visibility | Required plugin/provider/localization is explicit | Hidden external dependency discovered during apply |
| CEA-013 | Cost and risk | Blueprint reports bounded cost/risk categories | Mutation presented as free/low risk without evidence |
| CEA-014 | Durable implementation plan | Selected Blueprint generates governed execution plan | Checklist-only plan without durable state |
| CEA-015 | Role-specific view | Owner, marketer, operator, and admin views differ by responsibility | All roles receive unrestricted technical actions |
| CEA-016 | Operations handoff | Launch creates monitoring, reconciliation, backup, and incident runbooks | Project ends at publish/cutover |
| CEA-017 | Commercial packaging | Plan entitlements do not bypass runtime authority | Subscription alone grants provider write |
| CEA-018 | Capability retirement | Retired/degraded capability is not recommended normally | Stale implementation selected |
| CEA-019 | Evidence freshness | Discovery and readiness expire on relevant revision change | Stale site/plugin/connection evidence reused |
| CEA-020 | Cross-Brand isolation | Same Workspace Brands receive separate assessments | Assets or blockers leak across Brands |
| CEA-021 | WordPress phase registration | Phases A–P appear as Site Lifecycle Capability Packs | Functions remain invisible technical internals |
| CEA-022 | Phase A content | Draft-first content capability with reference repair and rollback evidence | Direct unsafe publish or broken refs |
| CEA-023 | Phase B builders | Elementor/template/navigation dependencies inventoried | Builder asset treated as ordinary post |
| CEA-024 | Phase C settings | Settings differences and reconciliation status available | Blind settings overwrite |
| CEA-025 | Phase D forms | Form integrations and risks inventoried | Webhook/payment/file-upload dependency omitted |
| CEA-026 | Phase E media | Featured/inline/orphan media relations inventoried | Broken media accepted as complete |
| CEA-027 | Phase F users/auth | Users, roles, and auth surfaces inventoried safely | Password/secret material exposed |
| CEA-028 | Phase G SEO | Redirect and metadata coverage classified | SEO loss omitted from migration plan |
| CEA-029 | Phase H analytics | GA/GTM/Meta/TikTok/custom/consent inventory available | Tracking presence inferred without ID/mode evidence |
| CEA-030 | Phase I performance | Cache/CDN/images/assets/lazyload assessed | Performance capability claimed without probe |
| CEA-031 | Phase J security | TLS/headers/WAF/exposed/hardening assessed | Unsafe cutover allowed without security gate |
| CEA-032 | Phase K observability | Logs/alerts/errors/uptime surface assessed | Store launched without monitoring handoff |
| CEA-033 | Phase L backup | Backup scope, retention, and recovery points assessed | Release allowed without restorable checkpoint |
| CEA-034 | Phase M release | Release, maintenance, cache, and rollback plan generated | Direct mutation without rollback |
| CEA-035 | Phase N integrity | Drift measured against tolerance | Silent source/target mismatch |
| CEA-036 | Phase O QA | Thresholded QA suite blocks failure | Critical checkout/site failures ignored |
| CEA-037 | Phase P cutover | DNS/TLS/CDN/monitoring/rollback window governed | Production cutover without explicit authority |
| CEA-038 | Continuous controls | Selected phases run as periodic controls | Lifecycle phases usable only once during migration |
| CEA-039 | SQL-primary migration | Capability operations persist in SQL authority | Google Sheets remains primary runtime state |
| CEA-040 | Legacy compatibility | Existing WordPress workflows remain available through adapter | Breaking removal before migration |
| CEA-041 | WordPress site profile | Exact Brand Site Profile resolves hostname, site role, and revisions | Domain alone grants access |
| CEA-042 | CMS grant | Draft/publish operation requires CMS and resource grants | Workspace membership alone publishes |
| CEA-043 | Capability envelope | WordPress write requires valid execution envelope | Connector write executes without envelope |
| CEA-044 | Credential intake recovery | Missing credential creates bounded intake and resume path | Secret requested in chat/log |
| CEA-045 | Exact WordPress connection | Site uses exact Brand connection binding | Legacy Brand password or fuzzy target used |
| CEA-046 | Woo discovery | Version, REST, HPOS, settings, extensions, cron, and system profile inventoried | Woo readiness inferred from plugin name only |
| CEA-047 | Woo REST authentication | Consumer credentials resolved from governed connection | Keys stored in Brand/site row |
| CEA-048 | Webhook secret separation | REST and webhook secrets have separate references | One secret copied into evidence or config |
| CEA-049 | Woo product read | Products/variations map to canonical Brand identities | External ID used as authority |
| CEA-050 | Woo product write | Write is idempotent, capability-gated, and read back | Duplicate product on retry |
| CEA-051 | Woo inventory standard | Standard mode clearly limits atomic cross-channel guarantees | Quantity update marketed as strict reservation |
| CEA-052 | Woo unique-item bridge | Concurrent unique-item reservations produce one winner | Two channels sell same unique item |
| CEA-053 | Woo projection mode | Direct Woo stock/order writes blocked or detected | Projection becomes second writer |
| CEA-054 | Woo order projection | Order line, totals, tax, shipping, payment, refund, attribution normalized | Raw provider order becomes canonical model |
| CEA-055 | Woo customer privacy | Customer projection is purpose-bound and pseudonymous where possible | Full customer payload logged |
| CEA-056 | Woo coupon mapping | Coupon and discount rules mapped with version and constraints | Unsupported discount silently approximated |
| CEA-057 | Woo refund | Refund idempotency and provider readback implemented | Duplicate refund after timeout |
| CEA-058 | Woo payment unknown | Unknown provider outcome enters reconciliation | Blind retry creates duplicate charge/order |
| CEA-059 | Woo webhook signature | Invalid signature rejected before processing | Forged order/product event accepted |
| CEA-060 | Woo webhook replay | Duplicate event stored once and acknowledged safely | Duplicate state transition |
| CEA-061 | Woo webhook health | Failed delivery/backlog appears in cockpit | Store appears healthy while events fail |
| CEA-062 | Scheduled actions | Woo scheduled-action backlog monitored | Subscription/payment/shipping jobs silently stuck |
| CEA-063 | Plugin classification | Active extensions classified by compatibility profile | All active plugins assumed safe |
| CEA-064 | Plugin conflict | Known conflicting plugin/topology blocks Blueprint | Incompatible extension activated |
| CEA-065 | HPOS compatibility | Adapter/extension HPOS compatibility recorded | Unsupported order storage mode accepted |
| CEA-066 | Version compatibility | WordPress/Woo/PHP matrix enforced | Uncertified version becomes writer |
| CEA-067 | Standard Woo Blueprint | Woo is sole writer for assigned domains | ERP/platform also writes stock/orders |
| CEA-068 | Woo+ERP Variant A | Woo order/inventory authority and ERP downstream mirror enforced | ERP changes Woo-owned inventory independently |
| CEA-069 | Woo+ERP Variant B | ERP authority and bridge-mediated Woo checkout enforced | Direct Woo order bypasses ERP authority |
| CEA-070 | Headless Woo | Session, cart, checkout, auth, SEO, cache, webhook contracts defined | Frontend assembled without lifecycle authority |
| CEA-071 | Content plus external commerce | WordPress content does not become inventory authority | Embedded product creates hidden writer |
| CEA-072 | Existing store takeover | Initial mode is discovery/read-only until certification | Immediate mutation of unknown live store |
| CEA-073 | Site operations cockpit | Commerce/site/analytics/security/backup health visible | User must inspect many provider consoles manually |
| CEA-074 | Recommended action evidence | Action shows impact, authority, connection, rollback, and readback | One-click opaque high-risk action |
| CEA-075 | Release canary | Storefront and checkout canaries run after release | Deployment declared healthy from HTTP 200 only |
| CEA-076 | Backup restore test | Recovery evidence includes actual bounded restore test | Backup file presence treated as recoverability |
| CEA-077 | Feed and analytics linkage | Woo product/order identity links to feeds and measurement | Campaign performance cannot reconcile to order |
| CEA-078 | Brand File Profile | Site media/campaign/evidence files use Brand roots | Personal Drive becomes shared store authority |
| CEA-079 | Agent parity | Agent uses same capability catalog and application services | Agent invokes provider directly |
| CEA-080 | Production certification | Sandbox behavioral suite and exact versions recorded | Documentation or mock used as production proof |
