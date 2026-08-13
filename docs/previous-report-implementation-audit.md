# تدقيق تنفيذ التقارير السابقة

**الفرع:** `feat/remote-mcp-dcr-dynamic-permissions`  
**آخر baseline مدقق قبل هذه الدفعة:** `5813f0ecb`  
**الغرض:** منع الخلط بين وجود توثيق أو wiring وبين إغلاق acceptance gate فعليًا.

## النتيجة التنفيذية

لا توجد بنود P0/P1/P2 مخفية خلف عبارة «تم التنفيذ» دون evidence في الكود أو الاختبارات. أُغلقت معظم بنود OAuth وsplitter وprovenance، لكن بقيت حدود معلنة لا يجوز اعتبارها منفذة: **نطاق Domain cookie الواسع وغياب إثبات subdomain trust boundary، عدم وجود policy adapter موحد فعليًا بين OpenAPI وMCP، وعدم وجود canary/live-DB verification أو ChatGPT browser-level test**.

> النتيجة الصحيحة هي: **لا يوجد omission غير موثق، لكن توجد بنود صُممت عمدًا كـpartial أو blocked بسبب القيود التشغيلية، ولا ينبغي إعلان production readiness لها.**

## مصفوفة P0

| البند | الحكم | الدليل الحالي | الملاحظة |
|---|---|---|---|
| P0-1 Cookie/gateway handoff | مغلق سلوكيًا | edge/runtime يمرران cookie فقط في OAuth handoff، وnamed-cookie/Set-Cookie filtering، واختبار round-trip في `test-auth-oauth-routes.mjs` و`test-activation-gateway.mjs` | لا يلغي ذلك ملاحظة P1 الخاصة بـ`Domain=.mad4b.com` |
| P0-2 PKCE S256 | مغلق | `tenantGptOAuthPkce.js`، challenge داخل code، verifier في token exchange، واختبارات mismatch/missing/replay | لا يوجد fallback إلى plain أو method آخر |
| P0-3 secret consistency | مغلق بالنسبة للبوابة السابقة | `JWT_SECRET` و`TENANT_GPT_SSO_SIGNING_SECRET` منفصلان وإلزاميان بحد 32 حرفًا؛ لا يوجد `development_fallback_secret_only` | يلزم secret rotation plan تشغيلي مستقل قبل production |

## مصفوفة P1

| البند | الحكم | الدليل الحالي | ما لم يُنفذ أو ما بقي مقيدًا |
|---|---|---|---|
| P1-1 SSO lifecycle | مغلق أساسيًا، جزئي للعمليات الحساسة | `sid`، migration additive، active/revoked lookup، revoke endpoint، password-reset invalidation، idle TTL افتراضي 8 ساعات وabsolute max 30 يومًا | لا يوجد step-up مستقل مربوط بكل sensitive mutation؛ write activation مغلق عمدًا |
| P1-2 Domain cookie blast radius | غير مغلق | cookie ما زالت `Domain=.mad4b.com` | لم يُنفذ host-only/one-time handoff، ولم يُثبت audit ملكية وثقة جميع subdomains؛ هذه فجوة أمنية معلنة |
| P1-3 scope minimization/union | مغلق جزئيًا قويًا | access JWT يأخذ effective subset، وSSO reissue يحفظ union، وincremental consent يرفض scope غير المغطى | لا يوجد registry تفصيلي يربط كل OpenAPI operation بـrequired scope مستقل؛ ما زالت مجموعة Tenant GPT المسموحة العامة هي مصدر الفلترة |
| P1-4 mutation governance | موثق، غير موحد | `docs/custom-gpt-mutation-governance.md` يصرح بوضوح بفصل OpenAPI/MCP؛ MCP لديه fail-closed write decision وOpenAPI لا يدخل MCP dispatcher | لم يُنفذ adapter مشترك `resource + operation + effect` ولا parity controls كاملة؛ لذلك لا توجد transport-independent governance |
| P1-5 refresh readiness | مغلق تصميميًا، غير مفعّل تشغيليًا | readiness يفحص flag، table، required indexes، JWT secret، transaction probe؛ metadata تعرض `refresh_ready` وevidence | migration لم تُطبق وflag ما زال مغلقًا؛ لا يوجد live production DB proof |
| P1-6 rotation rollback/concurrency | مغلق اختباريًا | rollback صريح، `SELECT ... FOR UPDATE`، atomic status update، واختبار concurrent refresh ينجح فيه request واحد فقط | الاختبار يستخدم fake pool؛ لا يزال live MySQL concurrency canary غير منفذ |
| P1-7 dynamic coverage | مغلق | candidate tags، exclusion records مع reason/owner/review date، fail-closed على unmapped candidate، و`unclassified_write_route_count=0` للجرد | exclusion decisions تحتاج مراجعة بشرية دورية عند إضافة routes جديدة |
| P1-8 marker overlap | مغلق أساسيًا | `shared_surface_allowlist` يحصر `listSystemTools` و`callSystemTool`، وأي overlap آخر يفشل | لم يُبنَ بعد semantic equivalence registry كامل للـeffect/authority بين السطحين |
| P1-9 trusted host | مغلق جزئيًا | تعارض `x-original-host` و`x-forwarded-host` يُرفض، والgateway يكتب trusted outbound headers | لا يمكن للمستودع وحده إثبات أن كل ingress production يزيل headers التي يرسلها caller؛ يلزم ingress audit/canary |
| P1-10 runtime coverage | مغلق جزئيًا قويًا | auth 180، gateway، PKCE، SSO round-trip/revoke، refresh concurrency fake-pool، token binding، MCP OAuth، splitter/parity | لا يوجد live DB refresh replay/concurrency أو browser-level ChatGPT/cross-host canary |

## مصفوفة P2

| البند | الحكم | الدليل الحالي | الملاحظة |
|---|---|---|---|
| P2-1 registry semantics | مغلق | registry version 2، candidate policy، selector model، governance tests | compatibility migration للمستهلكين خارج المستودع ما زالت مسؤولية review/deployment |
| P2-2 warning budget | مغلق على artifact/policy evidence | `warning_budget` داخل generated OpenAPI وgateway policy، ويظهر في gateway health | ليس بديلًا عن قرار production readiness مستقل؛ `tenant_core` ما زال متجاوزًا warning limit 26 عند 30 operation لكنه تحت hard limit 30 |
| P2-3 provenance | مغلق | source OpenAPI وregistry SHA-256 في artifacts وgateway policies، مع gateway attestation source commit | الـSHA يثبت المصدر المولد، بينما commit attestation يحتاج توقيع deployment فعلي خارج هذه الدفعة |
| P2-4 OAuth endpoint relationship | مغلق توثيقيًا/اختباريًا | registry يثبت auth authorization server وActivation gateway alias وone-client resource-bound consent، مع split governance tests | لا يوجد اختبار متصفح ChatGPT فعلي يثبت عدم إنشاء client ثانٍ أو عدم إعادة consent عبر host switch |

## القيود التي بقيت منفذة كما طُلب

لم تُفعّل أي write scope؛ inventory الحالي يثبت 6 scopes في وضع `shadow` و650 write routes مصنفة و0 unclassified. لم تُطبق migrations، بما في ذلك grants وSSO sessions، ولم تُنفذ provider mutations، ولم تُعدل Cloudflare أو Hostinger، ولم يُنشر Production، ولم يُدمج PR #7072.

## قرار readiness

الفرع صالح للمراجعة وstaging evidence، لكنه ليس production-ready بالمعنى الكامل. يلزم قبل أي تفعيل مستقل معالجة أو قبول صريح للفجوات الأربع التالية: **Domain cookie/subdomain trust audit، policy adapter الموحد أو قرار equivalent controls، live DB/concurrency/canary verification، وbrowser-level OAuth client behavior test**. لا يجوز إخفاء هذه البنود خلف نجاح الاختبارات المحلية.

## References

[1]: ../critical-review-custom-gpt-oauth-mcp.md "التقرير النقدي السابق"

[2]: ../tmp/remediation-acceptance-gates.md "بوابات القبول السابقة"

[3]: ./custom-gpt-openapi-oauth-delivery.md "تقرير التسليم الحالي"

[4]: ./custom-gpt-mutation-governance.md "قرار حوكمة التغييرات بين النقلين"
