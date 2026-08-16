# التدقيق العميق للباتش المجمع PR #7384

## النطاق

يراجع هذا التدقيق علاجات AutoPilot وStaging وActivation Gateway وProduction promotion وHostinger R7 وRemote MCP/OAuth trusted ingress وhost authority وDNS policy وE2E maintenance governance وgenerated artifacts. لا يجيز هذا الملف أي نشر Production أو Cloudflare/Hostinger/provider mutation؛ وتبقى R7 سلطة GET-only حصراً.

> ملاحظة: لا تُثبت هذه الوثيقة SHA ثابتة للفرع لأن generated-state writers قد تحرك رأس PR أثناء التقارب. GitHub live ref وexact-head checks هما السلطة عند أي قرار كتابة أو دمج.

## مصفوفة الأسباب الجذرية

| المعرّف | المشكلة المرصودة | السبب الجذري | الإصلاح/الحماية داخل PR | الحالة المتبقية |
|---|---|---|---|---|
| G-01 | `action_required` مع jobs فارغة على workflows محمية | GitHub قد يوقف workflow قبل إنشاء jobs | إبقاءها حالة حوكمة لا نجاحاً فنياً وعدم استخدامها كدليل جاهزية | خارجي/صلاحيات GitHub |
| G-02 | inventory/evaluation وderived state تحرك رأس PR بعد الدفع | writers محكومة متعددة تتقارب بعد تغييرات runtime/governance | CAS قبل كل كتابة، عدم force-push، والحفاظ على outputs التي تكتبها السلطات الرسمية | يلزم exact-head convergence قبل الدمج |
| G-03 | `parallel_work_pr_branch_not_declared` رغم أن workstreams المتأثرة مدمجة | single-PR maintenance gate تطلب `secrets_included=false` بينما E2E schema كانت تمنع الحقل، والعقد لم تغط كل runtime files | السماح الاختياري بالحقل في schema مع `const:false`، توسيع عقد `.changes/e2e` ليغطي كل runtime files، وإضافة regression ديناميكية للقبول/الرفض | يغلق بعد نجاح E2E Phase Governance على الرأس الجديد |
| G-04 | Work Map/Derived State تصبح stale بعد تغير source files | مشتقات متعددة لها writers مستقلة | عدم الكتابة اليدوية للمشتقات، وترك writers الرسمية تعيد التقارب بعد آخر source commit | يلزم readback نهائي |
| G-05 | Hostinger R7 أعادت 503 رغم نجاح Git promotion | branch promotion لا يثبت runtime activation | R7 تبقى negative حتى identity endpoints تعيد 200 وتطابق exact Production SHA/branch | تشغيلي/Hostinger runtime |
| G-06 | R7 كانت تعتمد على issue comment فقط | لم يكن هناك trigger مباشر من protected Production push | أضيف trigger `push` إلى Production مع exact-SHA/CAS مع إبقاء GET-only | داخل PR |
| G-07 | `TENANT_GPT_SSO_SIGNING_SECRET` قد يغيب عند Production startup | deployment/startup contract لم يكن يغلق هذا الشرط مبكراً بما يكفي | توثيق واختبار شرط secret metadata دون قراءة payload أو توليد بديل Production | provisioning الفعلي منفصل |
| G-08 | AutoPilot احتاج إصلاحات يدوية على Windows | env defaults وempty-secret replacement وbackup quarantine وScheduled Task contract غير مكتملة | دمج exact-SHA، local-only secrets، backup quarantine، host defaults وInteractive logon | داخل PR |
| G-09 | OAuth discovery قد تفشل 503 رغم صحة route code | Production trusted ingress يتطلب ثلاث attestations مستقلة | توثيق env الثلاثة، fail-closed metadata routes، Production-mode regression، وتصنيف `trusted_ingress_attestation_required` | provider ingress attestation فعلية منفصلة |
| G-10 | MCP وroot discovery كانا يختلفان في الثقة بـ`x-forwarded-host` | سلطتان مختلفتان لاستخراج external host | `trustedRequestHost.js` سلطة مشتركة مع رفض malformed/multi-value inputs واختبار spoofing | داخل PR |
| G-11 | repository DNS policy قالت CNAME بينما live Cloudflare evidence السابقة كانت proxied A | العقد خلط invariant المعماري مع syntax record واحدة | allowed set `[A,CNAME]` مع `dns_proxy_required=true` وHostinger origin invariant | live Cloudflare readback منفصل؛ لا mutation هنا |
| G-12 | الحاجة إلى إثبات MCP transport الحقيقي | R7 GET-only لا يمكنها إثبات `POST /mcp initialize` دون توسيع سلطة readback | تم رفض توسيع R7 إلى POST والحفاظ على GET-only governance؛ لا يدّعي هذا PR transport readiness | live POST initialize يحتاج تفويض/دليل تشغيلي منفصل بعد merge/deploy |

## قواعد عدم التخفيف

- لا `force-push` ولا كتابة مباشرة على `main` أو `Production`.
- لا credential payload read، ولا SQL/migration apply، ولا Cloudflare/Hostinger mutation داخل readback.
- لا تُعتبر 503 أو `action_required` نجاحاً.
- لا يُستنتج MCP transport readiness من OAuth GET metadata فقط.
- أي تحرك في PR HEAD يلغي صلاحية exact-head evidence السابقة ويستلزم إعادة التحقق.
- generated artifacts تُحدَّث بواسطة writers الرسمية فقط متى كانت لها authority معروفة.

## قرار التقدم

لا يُطلب merge/Owner Gate نهائي على رأس غير مستقر. يجب أولاً أن ينجح E2E Phase Governance بعد إصلاح maintenance contract/schema، ثم تتقارب generated artifacts وCI على exact HEAD واحد. بعد الدمج لا تُعلن Production current إلا من R7 ناجحة على exact Production SHA، ولا تُعلن MCP transport ready إلا بعد تحقق POST منفصل ومصرح به.
