# جاهزية قواعد البيانات الثلاث لـ Spec 020

## الغرض

يوثق هذا المستند فجوتين تشغيليتين ظهرتا أثناء تشخيص مسار Custom GPT وطبقة Hard Activation: نقص صلاحيات مستخدم Runtime على جلسات العملاء، وانجراف schema في كتالوج أدوات MCP حول الحقل `mcp_catalog_level`، إضافة إلى جاهزية قاعدة Runtime Persistence المستقلة لتخزين response chunks. المستند **مكتبي ومجهز فقط**؛ لا ينفذ grants أو migrations أو قراءة credentials أو Hard Activation.

> لا تُعد حالة provider أو GitHub أو Google Drive دليلًا كافيًا على جاهزية قواعد البيانات. يجب أن تنجح فحوص schema وprivilege وpersistence بصورة مستقلة، وبالهويات الصحيحة، قبل السماح بالانتقال من degraded إلى active.

## عقد الأدوار canonical

يعتمد المسار ثلاث هويات وقواعد بيانات منفصلة، ولا يسمح بأي fallback بينها:

| الدور | متغير القاعدة | متغير الهوية | الملكية |
|---|---|---|---|
| Runtime data | `DB_NAME` | `DB_USER` | `customer_sessions` و`tenant_platform_endpoint_tools`، بما في ذلك projection الخاصة بـ`mcp_catalog_level` |
| Governance control plane | `GOVERNANCE_DB_NAME` | `GOVERNANCE_DB_USER` | authority وenvelope وapproval وmigration وdispatch control-plane tables |
| Runtime Persistence | `RUNTIME_PERSISTENCE_DB_NAME` | `RUNTIME_PERSISTENCE_DB_USER` | `governed_tool_response_chunks` فقط |

لا يجوز إسناد `governed_tool_response_chunks` إلى Runtime أو Governance، ولا يجوز اعتبار `mcp_catalog_level` شرطًا لقاعدة Persistence. أي اختلاف في database name أو principal أو table ownership أو privileges هو حاجز blocking.

## التشخيص

يفشل `GET /activation/session-context` عندما يحاول مستخدم Runtime تنفيذ `INSERT` على `customer_sessions` دون privilege مناسب. ويظهر فشل مستقل في كتالوج الأدوات عندما يتوقع الكود الحقل `mcp_catalog_level` بينما لا يعيده schema الخاص بقاعدة Runtime. كما أن تخزين response chunks يحتاج هوية Persistence مستقلة وصلاحيات مباشرة على جدول chunks.

هذه الفجوات لا تثبت وجود عطل في provider bootstrap؛ بل تشير إلى عدم اتساق بين runtime database أو governance database أو persistence database ونسخة التطبيق أو migration ledger. لذلك يُعامل المسار fail-closed، ويظل catalog والـactivation في وضع shadow/degraded إلى أن تتوفر أدلة مستقلة لكل دور.

## خطة المعالجة المجهزة

| المسار | الهوية والقاعدة | دليل القراءة المطلوب | معيار النجاح | الفشل الآمن |
|---|---|---|---|---|
| جلسات Runtime | `DB_USER` على `DB_NAME` | `SHOW GRANTS` محدود و`INFORMATION_SCHEMA.TABLE_PRIVILEGES` | `SELECT`, `INSERT`, `UPDATE` على `customer_sessions` فقط، بلا grant option أو صلاحيات واسعة | `RUNTIME_SESSION_CONTEXT_INSERT_DENIED` |
| Tool Catalog | `DB_USER` على `DB_NAME` | schema readback وmigration checksum للحقل `mcp_catalog_level` | projection والتطبيق وschema متطابقة، ونجاح `listAdminTools` و`repo_inspect` للقراءة فقط | `MCP_CATALOG_SCHEMA_DRIFT` |
| Response chunks | `RUNTIME_PERSISTENCE_DB_USER` على `RUNTIME_PERSISTENCE_DB_NAME` | privilege وschema readback مباشر لجدول `governed_tool_response_chunks` | `SELECT`, `INSERT`, `UPDATE` لمسار الطلب، و`DELETE` للصيانة فقط | `RUNTIME_RESPONSE_CHUNK_PERSISTENCE_DENIED` |
| Governance authority | `GOVERNANCE_DB_USER` على `GOVERNANCE_DB_NAME` | identity وfoundation-table وprivilege readback | authority وenvelope وapproval وmigration bindings على قاعدة Governance المنفصلة | `GOVERNANCE_DB_SCHEMA_NOT_READY` |
| Hard Activation | الأدلة الأربع مع provider/binding evidence | جميع الأدلة مكتملة على نفس release SHA والهويات الثلاث | لا تفعيل قبل اكتمال schema وprivilege وparity وreadback | البقاء في `degraded` وعدم منح runtime authority |

## ترتيب التنفيذ بعد موافقة تشغيلية منفصلة

يُجهز أولًا least-privilege plan مستقل لكل دور، من دون منح schema-wide أو global write privileges. ثم تُحدد migration المالكة للحقل `mcp_catalog_level` في Runtime، وتُثبت migration الخاصة بجدول chunks في Persistence، ويُسجل checksum وschema readback قبل أي apply. بعد ذلك تُعاد اختبارات session-context و`repo_inspect` و`listAdminTools` واختبار response chunks في بيئة غير إنتاجية. ولا يُعاد تقييم Hard Activation إلا بعد ربط النتائج بنفس release SHA وبالهويات الثلاث الصحيحة.

## حدود الأمان

لا يحتوي هذا المسار على `GRANT`, `REVOKE`, `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE` أو أمر migration apply. ولا يقرأ credentials ولا يرسل provider mutations ولا يربط route runtime جديدًا. أي تنفيذ لاحق يحتاج موافقة تشغيلية مستقلة وتدقيقًا على بيئة الهدف. لا يُستخدم `DB_USER` كـfallback لمسار Persistence، ولا تُستخدم Governance DB كـRuntime DB ثانية.

## مرجع العقد

العقد canonical هو:

`specs/020-platform-resource-identity-brand-governance/contracts/runtime-database-readiness-contract.json`

إصدار العقد: `mad4b.spec020.runtime-database-readiness.v2`.
