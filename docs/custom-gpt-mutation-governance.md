# Custom GPT وRemote MCP: عقد حوكمة التغييرات

**الحالة:** design/staging only. هذا المستند يثبت قرارًا معماريًا صريحًا لمعالجة اعتراض المراجعة حول اختلاف enforcement plane بين Custom GPT OpenAPI وRemote MCP، ولا يفعّل أي write scope أو provider mutation.

## القرار المعماري

يستخدم المشروع **نقلين مستقلين** لكنهما يستهلكان الآن قرارًا مشتركًا من `sharedMutationPolicy.js`. يعمل Remote MCP عبر `tools/call` ويطبق adapter المشترك من خلال `remoteMcpWriteScopeGovernance.js`. أما Custom GPT OpenAPI فيمر عبر `openApiMutationGovernance.js` المركب قبل routes التسجيل؛ وعند وجود Tenant GPT bearer على mutation، تُرفض العملية fail-closed إذا لم توجد operation policy وscope promoted. لا يُعاد توجيه العملية إلى MCP dispatcher، لكن effect/authority/approval/lease/readback decision path موحد.

> الصياغة المعتمدة: **OpenAPI وRemote MCP مستقلان في النقل، مع shared mutation decision adapter وfail-closed enforcement؛ لا توجد write scope مفعلة، ولذلك لا تسمح طبقة OpenAPI الحالية بأي mutation قبل إضافة registry entry وترقية scope عبر البوابات المستقلة.**

| المجال | Custom GPT OpenAPI | Remote MCP | حالة هذه الدفعة |
|---|---|---|---|
| الهوية والموارد | OAuth Tenant GPT، مع host/resource binding وActivation audience | Remote MCP OAuth 2.1 وresource binding | مفعّل في staging |
| write scopes | لا توجد write scopes مفعلة؛ الجرد 6 scopes في shadow فقط | write decision fail-closed خلف policy MCP | لا activation |
| approval/capability/lease | نفس checks المشتركة؛ جميعها fail-closed قبل promotion | نفس checks المشتركة مع MCP-specific response taxonomy | parity contract |
| provider mutation | غير منفذة ضمن هذه الدفعة | غير منفذة ضمن هذه الدفعة | مغلق |
| readback | يظل contract route-specific حيث ينطبق | يظل contract MCP-specific حيث ينطبق | لا promotion |
| readiness | `mutation_governance_ready=false` حتى توجد operation registry entries وscope promotion | `mutation_governance_ready=false` لأن scopes shadow | review/staging |

## تصنيف عمليات OpenAPI ذات الأثر التغييري

تُعامل عمليات POST وPUT وPATCH وDELETE التي تغيّر حالة النظام كـ**عمليات تغيير** حتى لو كانت schema متاحة من خلال Custom GPT. تشمل الأمثلة resource restore، dashboard preference update، plugin install، credential-intake session، skill-approval decision، case transitions، وtask-source repair apply/verify. لا تمنح هذه التصنيفات صلاحية تلقائية، ولا تُحوّل أي scope shadow إلى authorization فعلي.

قبل أي تفعيل مستقل لمسار OpenAPI mutations، يجب أن يثبت route contract على الأقل هوية المستخدم والـtenant، membership وrole، operation effect، idempotency عند الحاجة، approval أو capability، وسجلًا قابلًا للتدقيق مع readback عندما تكون العملية provider-facing. إذا كان أحد هذه الشروط غير موجود في route بعينها، تبقى العملية في review/staging ولا تُعتبر mutation-governance-ready.

## حدود هذه الدفعة

لم تُفعّل write scopes، ولم تُطبّق migrations، ولم تُنفذ provider mutations، ولم تُعدل Cloudflare أو Hostinger، ولم تُنشر Production، ولم يُدمج PR #7072. لذلك فإن نتيجة القبول الصحيحة هي فصل transport مع shared adapter fail-closed، وإبقاء أي promotion لعملية write مؤجلًا إلى registry تفصيلي ومراجعة مستقلة.

## شروط الانتقال إلى policy مشتركة

أصبح registry مولدًا فعليًا في `openapi/openapi-mutation-policy.generated.json`، ويحصي 29/29 mutation operations كـ`accounted_for`. تبقى entries جميعها `unbound` عمدًا، ولذلك يمنع enforcement adapter أي write قبل مراجعة resource-operation-effect وربط scope مستقل وترقيته. أضيفت اختبارات parity تثبت تطابق failed checks بين OpenAPI وMCP، واختبار browser-like/cross-host read-only canary، و`tenantGptOperationalReadiness.js` الذي يعرض blocking checks دون إعلان production readiness. لا يمكن لأي adapter السماح بالكتابة في هذه الدفعة لأن scopes ما زالت `shadow` وprovider mutations محظورة.

## أدلة المصدر

| الدليل | الغرض |
|---|---|
| `http-generic-api/remoteMcpConnectorRuntime.js` | مصدر قرار MCP write scope fail-closed |
| `http-generic-api/openapi.yaml` | مصدر عمليات Custom GPT وmarkers والتصنيف الأولي |
| `http-generic-api/scripts/split-openapi.mjs` | توليد الأسطح دون اعتماد runtime على MCP |
| `canonicals/openapi/custom-gpt-surfaces.yaml` | registry وcandidate policy وsurface separation |
| `docs/write-scope-inventory.md` | الجرد الموحد للـwrite routes والـshadow scopes |
| `http-generic-api/test-openapi-split-governance.mjs` | اختبار استقلال وتوليد الأسطح |
| `http-generic-api/openapi/openapi-mutation-policy.generated.json` | registry لجميع 29 mutation operations مع unbound fail-closed status |
| `http-generic-api/tenantGptOperationalReadiness.js` | تجميع readiness للـDB/ingress/canary/client evidence |
| `docs/tenant-gpt-secret-and-canary-runbook.md` | خطوات التشغيل الخارجي والتدوير دون تنفيذ ضمن الدفعة |

## References

[1]: https://www.rfc-editor.org/rfc/rfc9700 "RFC 9700: Best Current Practice for OAuth 2.0 Security"

[2]: https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/7072 "Pull Request #7072"
