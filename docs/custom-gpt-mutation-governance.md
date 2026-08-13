# Custom GPT وRemote MCP: عقد حوكمة التغييرات

**الحالة:** design/staging only. هذا المستند يثبت قرارًا معماريًا صريحًا لمعالجة اعتراض المراجعة حول اختلاف enforcement plane بين Custom GPT OpenAPI وRemote MCP، ولا يفعّل أي write scope أو provider mutation.

## القرار المعماري

يستخدم المشروع حاليًا **مستويين منفصلين لحوكمة التغيير** مع ضوابط مكافئة جزئيًا، وليس policy واحدة transport-independent. يعمل Remote MCP عبر `tools/call` ويطبق قرار write scope fail-closed من `remoteMcpConnectorRuntime.js`. أما Custom GPT OpenAPI فيمر عبر routes المولدة من `openapi.yaml` مع OAuth resource binding وطبقات authorization الخاصة بالمسار، ولا يُعاد توجيه العملية إلى MCP write dispatcher.

> الصياغة المعتمدة: **OpenAPI وRemote MCP مستقلان في النقل، مع فصل أمني موثق؛ لا تُعتبر mutation governance موحدة عبر النقلين حتى يتم بناء adapter مشترك يطبق نفس effect/authority/approval/lease/readback policy على كلا المسارين.**

| المجال | Custom GPT OpenAPI | Remote MCP | حالة هذه الدفعة |
|---|---|---|---|
| الهوية والموارد | OAuth Tenant GPT، مع host/resource binding وActivation audience | Remote MCP OAuth 2.1 وresource binding | مفعّل في staging |
| write scopes | لا توجد write scopes مفعلة؛ الجرد 6 scopes في shadow فقط | write decision fail-closed خلف policy MCP | لا activation |
| approval/capability/lease | يعتمد على route/application authorization الحالي؛ لا يدعي adapter مشترك | `evaluateRemoteMcpWriteScopeDecision` ومسار MCP write governance | فصل موثق |
| provider mutation | غير منفذة ضمن هذه الدفعة | غير منفذة ضمن هذه الدفعة | مغلق |
| readback | يظل contract route-specific حيث ينطبق | يظل contract MCP-specific حيث ينطبق | لا promotion |
| readiness | `mutation_governance_ready=false` لهذه الدفعة إذا كان المطلوب transport-independent enforcement | `mutation_governance_ready=true` فقط لمسار MCP المعزول | review required |

## تصنيف عمليات OpenAPI ذات الأثر التغييري

تُعامل عمليات POST وPUT وPATCH وDELETE التي تغيّر حالة النظام كـ**عمليات تغيير** حتى لو كانت schema متاحة من خلال Custom GPT. تشمل الأمثلة resource restore، dashboard preference update، plugin install، credential-intake session، skill-approval decision، case transitions، وtask-source repair apply/verify. لا تمنح هذه التصنيفات صلاحية تلقائية، ولا تُحوّل أي scope shadow إلى authorization فعلي.

قبل أي تفعيل مستقل لمسار OpenAPI mutations، يجب أن يثبت route contract على الأقل هوية المستخدم والـtenant، membership وrole، operation effect، idempotency عند الحاجة، approval أو capability، وسجلًا قابلًا للتدقيق مع readback عندما تكون العملية provider-facing. إذا كان أحد هذه الشروط غير موجود في route بعينها، تبقى العملية في review/staging ولا تُعتبر mutation-governance-ready.

## حدود هذه الدفعة

لم تُفعّل write scopes، ولم تُطبّق migrations، ولم تُنفذ provider mutations، ولم تُعدل Cloudflare أو Hostinger، ولم تُنشر Production، ولم يُدمج PR #7072. لذلك فإن نتيجة القبول الصحيحة هي فصل transport مع إبقاء claim التوحيد الكامل مؤجلًا إلى adapter مشترك ومراجعة مستقلة.

## شروط الانتقال إلى policy مشتركة

ينبغي إنشاء policy registry يربط `resource + operation_id + effect` بـauthority وrequired scope وapproval وlease وreadback، ثم إضافة adapter OpenAPI وآخر MCP يستهلكان نفس القرار. يجب أن يفشل كل adapter مغلقًا عند غياب registry entry أو عند اختلاف effect أو subject أو resource. بعد ذلك تُضاف اختبارات parity تثبت أن نفس العملية المنطقية تنتج قرارًا متماثلًا عبر النقلين، مع اختبار رفض write route غير مصنفة.

## أدلة المصدر

| الدليل | الغرض |
|---|---|
| `http-generic-api/remoteMcpConnectorRuntime.js` | مصدر قرار MCP write scope fail-closed |
| `http-generic-api/openapi.yaml` | مصدر عمليات Custom GPT وmarkers والتصنيف الأولي |
| `http-generic-api/scripts/split-openapi.mjs` | توليد الأسطح دون اعتماد runtime على MCP |
| `canonicals/openapi/custom-gpt-surfaces.yaml` | registry وcandidate policy وsurface separation |
| `docs/write-scope-inventory.md` | الجرد الموحد للـwrite routes والـshadow scopes |
| `http-generic-api/test-openapi-split-governance.mjs` | اختبار استقلال وتوليد الأسطح |

## References

[1]: https://www.rfc-editor.org/rfc/rfc9700 "RFC 9700: Best Current Practice for OAuth 2.0 Security"

[2]: https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/7072 "Pull Request #7072"
