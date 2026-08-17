# جاهزية قاعدة بيانات Runtime لـ Spec 020

## الغرض

يوثق هذا المستند فجوتين تشغيليتين ظهرتا أثناء تشخيص مسار Custom GPT وطبقة Hard Activation: نقص صلاحيات مستخدم قاعدة بيانات runtime على جلسات العملاء وكتل الاستجابات، وانجراف schema في كتالوج أدوات MCP حول الحقل `mcp_catalog_level`. المستند **مكتبي ومجهز فقط**؛ لا ينفذ grants أو migrations أو قراءة credentials أو Hard Activation.

> لا تُعد حالة provider أو GitHub أو Google Drive دليلًا كافيًا على جاهزية قاعدة بيانات runtime. يجب أن تنجح فحوص schema وprivilege وpersistence بصورة مستقلة قبل السماح بالانتقال من degraded إلى active.

## التشخيص

يفشل `GET /activation/session-context` عندما يحاول مستخدم runtime `u338416126_growthOS` تنفيذ `INSERT` على `customer_sessions` من دون privilege مناسب. ويظهر فشل مستقل في كتالوج الأدوات عندما يتوقع الكود الحقل `mcp_catalog_level` بينما لا يعيده schema المتصل به. كما أن تخزين response chunks قد يفشل بسبب drift إضافي في صلاحيات الجدول المخصص للمثابرة.

هذه الفجوات لا تثبت وجود عطل في provider bootstrap؛ بل تشير إلى عدم اتساق بين runtime database ونسخة التطبيق أو migration ledger. لذلك يُعامل المسار fail-closed، ويظل catalog والـactivation في وضع shadow/degraded إلى أن تتوفر أدلة مستقلة.

## خطة المعالجة المجهزة

| المسار | دليل القراءة المطلوب | معيار النجاح | الفشل الآمن |
|---|---|---|---|
| جلسات runtime | `SHOW GRANTS` محدود للمستخدم وقراءة `INFORMATION_SCHEMA.TABLE_PRIVILEGES` | `SELECT`, `INSERT`, `UPDATE` على `customer_sessions` فقط، بلا grant option أو صلاحيات واسعة | `RUNTIME_SESSION_CONTEXT_INSERT_DENIED` |
| response chunks | قراءة privileges على `governed_tool_response_chunks` | `SELECT`, `INSERT`, `UPDATE` لمسار الكتابة، و`DELETE` للصيانة فقط | `RUNTIME_RESPONSE_CHUNK_PERSISTENCE_DENIED` |
| Tool Catalog | قراءة schema وmigration checksum للحقل `mcp_catalog_level` | schema readback يطابق projection والكود، ونجاح `listAdminTools` و`repo_inspect` للقراءة فقط | `MCP_CATALOG_SCHEMA_DRIFT` |
| Hard Activation | تجميع الأدلة الثلاثة مع provider/binding evidence | جميع الأدلة مكتملة على نفس database identity وmigration revision | البقاء في `degraded` وعدم منح runtime authority |

## ترتيب التنفيذ بعد موافقة تشغيلية منفصلة

يُجهز أولًا least-privilege grant plan للجدولين المحددين، من دون منح schema-wide أو global write privileges. ثم تُحدد migration المالكة للحقل `mcp_catalog_level` ويُسجل checksum وschema readback قبل أي apply. بعد ذلك تُعاد اختبارات session-context و`repo_inspect` و`listAdminTools` واختبار response chunks في بيئة غير إنتاجية. ولا يُعاد تقييم Hard Activation إلا بعد ربط النتائج بنفس database identity ونسخة التطبيق.

## حدود الأمان

لا يحتوي هذا المسار على `GRANT`, `REVOKE`, `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE` أو أمر migration apply. ولا يقرأ credentials ولا يرسل provider mutations ولا يربط route runtime جديدًا. أي تنفيذ لاحق يحتاج موافقة تشغيلية مستقلة وتدقيقًا على بيئة الهدف.

## مرجع العقد

العقد canonical هو:

`specs/020-platform-resource-identity-brand-governance/contracts/runtime-database-readiness-contract.json`

