# تقرير تسليم: Custom GPT OpenAPI + Remote MCP OAuth

**المستودع:** `mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os`
**الفرع:** `feat/remote-mcp-dcr-dynamic-permissions`
**نطاق الدفعة:** تشغيل مساري Custom GPT OpenAPI وRemote MCP OAuth بالتوازي، وإضافة توليد Admin/Tenant ديناميكيًا من source OpenAPI، وتحسين استمرارية جلسة Tenant GPT دون إطالة access-token أو تجاوز OAuth consent.

## النتيجة التنفيذية

تم فصل مسار **Custom GPT OpenAPI schemas/actions** عن مسار **Remote MCP OAuth** على مستوى source selection وgeneration وruntime contracts. أصبح `http-generic-api/openapi.yaml` مصدر الحقيقة لمسارات Custom GPT، بينما تبقى طبقات MCP وwrite governance مستقلة ولا تُستدعى أثناء توليد أو تشغيل OpenAPI schemas. لذلك لا يكون MCP عائقًا أمام Custom GPT OpenAPI، ولا يصبح Custom GPT شرطًا لتشغيل Remote MCP.

تم تحويل الأسطح الأربعة المولدة إلى source-marker selectors في `canonicals/openapi/custom-gpt-surfaces.yaml`، ورفع registry إلى **version 2**. كل operation مصنفة بـ`x-custom-gpt-surfaces` تُدرج تلقائيًا في السطح الموافق لها، وتُزال العلامة الداخلية من artifact الناتج حتى لا تظهر كجزء من contract العام. أصبح لكل surface `candidate_policy` بوضع `marker_required` و`omission: fail`، ويطبق splitter validation للـcandidate contract ورفض marker overlap غير الموجود في `shared_surface_allowlist`. كما تحمل artifacts الناتجة `x-custom-gpt-generation` مع source/registry SHA-256 وregistry version وعدد العمليات وحالة warning budget.

| السطح | المضيف | auth profile | العمليات بعد التوليد | آلية الاختيار |
|---|---|---:|---:|---|
| `admin_core` | `auth.mad4b.com` | `admin_service` | 23 | `source_markers: [admin_core]` |
| `activation_admin` | `activation.mad4b.com` | `admin_service` | 9 | `source_markers: [activation_admin]` |
| `tenant_core` | `auth.mad4b.com` | `tenant_oauth` | 30 | `source_markers: [tenant_core]` |
| `tenant_activation` | `activation.mad4b.com` | `tenant_oauth` | 15 | `source_markers: [tenant_activation]` |

## استقلال OpenAPI عن Remote MCP

مسار `scripts/split-openapi.mjs` يقرأ source OpenAPI وsurface registry فقط. لا يحتوي generator على اعتماد runtime على Remote MCP، ولا يمرر operations إلى `tools/call` أو إلى write governance. أما runtime الخاص بـRemote MCP فيظل مسؤولًا عن `tools/list` و`tools/call` وOAuth 2.1 وpermission tree، مع استمرار fail-closed write decisions.

أضيفت اختبارات parity تثبت أن artifacts Custom GPT لا تحتوي source-only marker `x-custom-gpt-surfaces`، وأنها تحتفظ بمضيفي `auth.mad4b.com` و`activation.mad4b.com` وبـOAuth resource separation. كما تم الحفاظ على Tenant aliases مثل `activateSession` و`listTools` و`callTool` و`writeSessionTurn` و`endSession` عبر projection من `x-tenant-gpt-operationId` إلى operationId في schema الناتج.

## Admin/Tenant Auto Splitter من source OpenAPI

أصبح registry يحدد marker الخاص بكل surface، مع `order_operation_ids` توافقية لعدم إعادة ترتيب العمليات القديمة دون داعٍ. عند إضافة operation جديدة إلى source OpenAPI، يجب أن تمر عبر candidate policy؛ route بلا marker أو exclusion record معتمد لا تُسقط بصمت، بل تفشل عملية generation عندما يثبتها candidate selector. ويُرفض multi-surface marker افتراضيًا إلا للعمليتين allowlisted `listSystemTools` و`callSystemTool`. يخضع كل artifact إلى builder validation وresponse-object validation وoperation-budget checks، وتظهر تجاوزات warning budget داخل provenance metadata بدل الاكتفاء برسالة console.

تم تحديث اختبارات `test-openapi-split-governance.mjs` و`test-openapi-split-regeneration-parity.mjs` و`test-tenant-activation-session-alias.mjs` لتتحقق من marker selectors، وعدم تسريب markers إلى artifacts، وتساوي عدد العمليات الفعلي مع source classification.

## auth.mad4b.com وactivation.mad4b.com

يبقى `auth.mad4b.com` مصدر authorization/token الأساسي لمسار Tenant Core، بينما يمر Tenant Activation من `activation.mad4b.com` مع الحفاظ على protected-resource distinction داخل `tenantGptOAuthResourceProfile.js`. لا يتم دمج resource audiences أو host policies في قيمة واحدة. ويستمر `state` وPKCE وredirect binding وtenant membership validation في جميع المسارات.

بهذا التصميم يمكن لـTenant GPT استخدام `Sign in with auth.mad4b.com`، ويمكن لسطح Activation استخدام `activation.mad4b.com` دون أن يتطلب أحدهما إعادة بناء أو تشغيل MCP. الجلسة الموحدة لا تمنح access إلى resource آخر تلقائيًا؛ بل تُستخدم فقط كجلسة هوية لـauthorization-code issuance، ثم يحدد host/resource المطلوب نطاق الكود والتوكن.

## تقليل إعادة تسجيل الدخول والاحتفاظ الآمن

أضيفت وحدة `tenantGptSsoSession.js` لجلسة SSO موقعة ومحدودة. cookie اسمها `mad4b_tenant_gpt_sso` وتستخدم `Domain=.mad4b.com` و`Path=/` و`HttpOnly` و`Secure` و`SameSite=Lax`. المدة الافتراضية والحد الأقصى **30 يومًا**، بينما access-token نفسه لا يزال short-lived وفق profile الحالي وبحد أقصى **3600 ثانية**. تتضمن الجلسة `sid` عشوائيًا، ويدعم المسار persistent active/revoked lookup، و`POST /auth/oauth/revoke`، وinvalidation لكل جلسات المستخدم بعد password reset. migration الجلسات additive وغير مطبقة؛ وعند غياب store لا يصدر المسار cookie قابلة لإعادة الاستخدام. لم تتم معالجة الحاجة إلى إعادة الدخول عبر تمديد bearer token إلى أيام.

يظهر خيار Continue with existing session فقط إذا كانت الجلسة صالحة، ومربوطة بالـclient، وتغطي scopes المطلوبة. عند استخدام `prompt=login` لا يسمح المسار بالـsilent reuse. وعند إصدار authorization code من جلسة SSO يعاد فحص المستخدم والعضوية والـtenant في قاعدة البيانات؛ لذلك لا تكفي cookie قديمة إذا أصبحت العضوية revoked أو أصبح الحساب inactive. إذا طلب المسار scope غير موجود في الجلسة، يعيد `incremental_consent_required` بدل منح scope بصمت.

أضيف أيضًا مسار refresh-token rotation لـTenant GPT، لكنه **staged ومغلق افتراضيًا** عبر `TENANT_GPT_REFRESH_TOKENS_ENABLED=true`. عند تفعيله بعد تجهيز قاعدة البيانات، يكون refresh token opaque ومخزنًا كـhash، ومدته 30 يومًا، ويُدار بالـrotation مع ربط client/resource/user/tenant وفحص active membership. لا يطيل ذلك access-token الذي يبقى ساعة واحدة كحد أقصى. لا تعلن metadata `refresh_token` إلا عند `tenantGptRefreshReady` الذي يفحص flag ووجود جدول grants وJWT secret وtransaction probe، وتعرض `refresh_ready` وسبب الجاهزية دون أسرار.

## قاعدة البيانات والحدود التشغيلية

أضيفت migration additive باسم `http-generic-api/migrations/20260813_tenant_gpt_oauth_grants_v1.sql` لإنشاء `tenant_gpt_oauth_grants` مع hash وstatus وresource وtenant/user bindings وrefresh expiry وrotation metadata. **لم يتم تطبيق migration**، ولذلك لا ينبغي تفعيل `TENANT_GPT_REFRESH_TOKENS_ENABLED` في بيئة لا تحتوي الجدول وتحققًا مستقلاً من readiness.

لم يتم تفعيل أي write scope، ولم تُنفذ provider mutation، ولم تُعدل Cloudflare أو Hostinger، ولم يُنشر Production، ولم يتم merge لأي PR. الجرد الحالي ما زال fail-closed ويصنف **650 write routes**، مع **612 intentionally-unmapped candidates** و6 shadow write scopes وعدم منح أي authorization تلقائي؛ الزيادة route lifecycle إضافية لمسار SSO revoke. ويثبت `docs/custom-gpt-mutation-governance.md` أن OpenAPI وRemote MCP لهما enforcement planes منفصلة في هذه الدفعة؛ لذلك لا يُدّعى transport-independent mutation governance قبل بناء adapter policy مشترك ومراجعته مستقلًا.

## التحقق والاختبارات

نجحت حزمة Custom GPT schema tests بعدد **531 اختبارًا ناجحًا و0 فشل**. كما نجحت اختبارات OpenAPI registry governance وregeneration parity وTenant Activation alias وSSO session وrefresh retention، واختبارات Tenant GPT OAuth token binding/exchange، وRemote MCP OAuth 2.1، وSpec 012 T031/T033.

نجحت `npm run evaluation:loop`. القرار النهائي هو `warn` بلا blocking gaps؛ التحذيرات الموجودة هي `AUTO-CI-SURFACE-SIZE` و`MAINT-LARGE-TRACKED-FILES` وهي تحذيرات صيانة مسبقة وليست فشلًا في contract أو OAuth readiness. كما نجحت checks الخاصة بـrepository inventory وwrite-scope inventory وreference architecture.

## الملفات الأساسية

| الملف | الغرض |
|---|---|
| `http-generic-api/openapi.yaml` | source OpenAPI مع source markers لـAdmin/Tenant surfaces |
| `canonicals/openapi/custom-gpt-surfaces.yaml` | registry canonical للـsurface markers والترتيب التوافقي |
| `http-generic-api/scripts/split-openapi.mjs` | dynamic marker-driven splitter وcoverage/limits validation |
| `http-generic-api/routes/authRoutes.js` | SSO session reuse وscope subset وprompt=login behavior |
| `http-generic-api/tenantGptSsoSession.js` | cookie/JWT session policy بحد 30 يومًا |
| `http-generic-api/tenantGptOAuthGrantStore.js` | staged refresh grant hashing وrotation |
| `http-generic-api/routes/tenantGptOAuthTokenExchangeRoutes.js` | authorization_code وflag-gated refresh_token exchange |
| `http-generic-api/migrations/20260813_tenant_gpt_oauth_grants_v1.sql` | migration grants additive غير مطبقة |
| `http-generic-api/migrations/20260813_tenant_gpt_sso_sessions_v1.sql` | migration SSO sid/revocation additive غير مطبقة |
| `http-generic-api/test-tenant-gpt-sso-session.mjs` | SSO cookie/TTL/claim tests |
| `http-generic-api/test-tenant-gpt-oauth-refresh-retention.mjs` | refresh flag/rotation/readiness/migration contract tests |
| `http-generic-api/test-custom-gpt-mutation-governance-contract.mjs` | قرار mutation governance وفصل transport مع write scopes مغلقة |
| `docs/custom-gpt-mutation-governance.md` | policy decision وacceptance boundary لمسارات OpenAPI وMCP |

## الخطوة التشغيلية التالية المقترحة

قبل أي تفعيل، يلزم إجراء independent review لمسار session policy، والتحقق read-only من وجود جدول grants في البيئة المستهدفة، ثم تشغيل migration وفق موافقة منفصلة، ثم canary على `auth.mad4b.com` و`activation.mad4b.com` مع flag disabled أولًا. بعد ذلك فقط يمكن تقييم تفعيل refresh grants، دون تغيير write scopes أو provider mutation policy.

## References

[1]: https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/tree/main/http-generic-api/openapi "المسار العام لملفات OpenAPI وCustom GPT schemas"

[2]: https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/blob/main/http-generic-api/openapi.yaml "مصدر OpenAPI الرئيسي"

[3]: https://auth.mad4b.com "واجهة API العامة لـauth.mad4b.com"

[4]: https://activation.mad4b.com "واجهة المضيف الخاص بمسار Activation"
