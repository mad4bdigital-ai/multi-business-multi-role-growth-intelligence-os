# Tenant GPT Secret Rotation and External Canary Runbook

**الحالة:** staging/design only. لا ينفذ هذا المستند تدويرًا أو migration أو نشرًا؛ وهو يحدد خطوات التشغيل التي يجب أن ينفذها مسؤول مستقل بعد الموافقة.

## الغرض

يمنع هذا الدليل خلط تدوير `JWT_SECRET` الخاص بتوقيع authorization code/access token مع تدوير `TENANT_GPT_SSO_SIGNING_SECRET` الخاص بجلسة SSO. يجب أن يبقى كل secret مستقلًا، بطول لا يقل عن 32 حرفًا، وألا يُكتب في logs أو commits أو artifacts.

## بوابة ما قبل التغيير

قبل أي تغيير، يجب أن تكون بيئة التنفيذ محددة بوضوح، وأن يثبت مسؤول التشغيل أن `TENANT_GPT_REFRESH_TOKENS_ENABLED=false`، وأن write scopes غير مفعلة، وأن migrations لم تُطبق ضمن هذه الدفعة. يجب أخذ read-only evidence من authorization metadata وhealth endpoints وحفظ hashes فقط دون حفظ tokens أو cookies.

| الفحص | شرط القبول |
|---|---|
| `JWT_SECRET` | موجود، مستقل، بطول 32 حرفًا على الأقل |
| `TENANT_GPT_SSO_SIGNING_SECRET` | موجود، مستقل، بطول 32 حرفًا على الأقل |
| trusted ingress | proxy headers enabled، ingress attested، caller headers stripped |
| gateway policy | source/registry fingerprints متطابقة وtoken route لا يمرر session cookie |
| refresh | `refresh_ready=false` إلى أن تكون migration وindexes وtransaction probe مثبتة حيًا |
| writes | `write_scopes_enabled=false` و`provider_mutation_allowed=false` |

## تدوير SSO secret

يُنشئ المسؤول secret جديدًا خارج المستودع، ثم يضعه في secret manager مع versioned key reference. يُعاد تشغيل auth service في staging أولًا، وتُرفض الجلسات القديمة عمدًا إذا لم يوجد dual-key verification contract معتمد. بعد ذلك يُنفذ read-only OAuth authorize/code/revoke canary، وتُراجع سجلات عدم تسريب secret أو cookie value. لا يُستخدم `JWT_SECRET` كبديل.

## تدوير JWT secret

يُنشئ المسؤول secret جديدًا، ثم ينسق restart مع code/token exchange. يجب اعتبار authorization codes وaccess tokens الموقعة بالسر القديم منتهية، وإعادة اختبار PKCE S256 وresource/client binding. لا يجوز تفعيل refresh tokens لمجرد نجاح restart؛ capability لا تُعلن إلا عند `tenantGptRefreshReady`.

## Trusted ingress verification

لا تُعتبر بيئة production أو canary جاهزة إلا إذا كانت متغيرات `REMOTE_MCP_TRUST_PROXY_HOST_HEADERS=true` و`REMOTE_MCP_TRUSTED_INGRESS_ATTESTED=true` و`REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS=true` مثبتة من ingress owner. يجب تنفيذ request read-only يرسل قيمًا متعارضة في `x-original-host` و`x-forwarded-host` و`Host`، وإثبات أن ingress يكتب القيم canonical أو يزيل caller-supplied values قبل وصولها إلى application.

## DB and external canary

يجب أن يثبت مسؤول قاعدة البيانات read-only وجود جدول grants وrequired indexes وmigration version، ثم يثبت transaction probe وconcurrent refresh replay test على نسخة canary. لا يُسمح بتطبيق migration كجزء من هذه الدفعة. بعد ذلك ينفذ مسؤول مستقل canary authorize → activation code → token، ويتأكد من أن SSO cookie تمرر فقط إلى authorize/code ولا تصل إلى token endpoint، وأن `prompt=login` لا يعيد استخدام الجلسة بصمت.

## Rollback

إذا فشل أي فحص، يعاد secret version السابق وفق secret manager audit trail، وتبقى flags مغلقة، ويُعاد تشغيل auth/gateway. لا تُحذف جلسات revocation evidence ولا تُعاد تهيئة الجداول. أي failure في trusted ingress أو refresh readiness يعيد الحالة إلى `NO-GO`.

## Evidence contract

يجب أن يحتوي تقرير التغيير على commit SHA، registry/source fingerprints، readiness JSON منزوع الأسرار، نتائج الاختبارات، وقرار مستقل. لا يجوز أن يحتوي التقرير على `Authorization` headers أو access/refresh tokens أو cookie values أو secret material.
