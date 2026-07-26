# تقرير إعادة التحقق الموحّد — Mad4B Tenant Platform

**التاريخ:** 23 يونيو 2026  
**نطاق التقرير:** Tenant-scoped verification  
**عدد موجات الاختبار المكتملة:** 34  
**المجموعات المحجوبة بعقد المنصة:** 3  
**حالة التنفيذ الفعلي أثناء الاختبارات:** لم يحدث أي تنفيذ فعلي أو Provider Dispatch أو Mutation

---

## 1. الملخص التنفيذي

تم تنفيذ جميع موجات التحقق الآمنة المتاحة من Tenant surface، باستخدام قراءات tenant-safe وresolver previews وعمليات preflight فقط.

### قرار الجاهزية

**المنصة غير جاهزة حاليًا لتفعيل تنفيذ tenant غير مقيد أو لتوسيع صلاحيات state-changing actions.**

يمكن اعتبارها مناسبة بصورة محدودة للآتي:

- القراءات tenant-scoped.
- الاستعلامات الوصفية التي لا تنفذ provider calls.
- resolver previews عند بقاء جميع البوابات الحالية fail-closed.
- إدارة الاتصال الأساسية بدون استخدام أسرار داخل المحادثة.

لا ينبغي اعتبارها جاهزة للآتي قبل معالجة بنود P0:

- تنفيذ actions أو tools تغيّر حالة النظام.
- الاعتماد على action-path approval كحاجز موثوق.
- منح smoke certificates جديدة على capabilities عالية الخطورة.
- استخدام agent identity كعنصر تفويض.
- اختيار credentials متعددة النطاقات بدون provenance صريح.
- تشغيل Local Connector أو Local Gateway من Tenant GPT.

### خلاصة المخاطر

| المستوى | الحكم |
|---|---|
| **P0 — حرج** | توجد فجوات في action-path authorization، selector handling، agent validation، risk classification، credential-scope isolation، وaction/tool parity. |
| **P1 — مرتفع** | capability registry غير متسق مع runtime، catalog exposure واسع، support lifecycle stale، pagination والfilters غير مطبقة، smoke binding غير مكتمل. |
| **P2 — متوسط** | identifier-format contracts، beta lifecycle transparency، status naming، وreadiness semantics تحتاج ضبطًا. |

---

## 2. منهجية الاختبار وحدود السلامة

تم استخدام:

- Tenant-safe list/get/status calls.
- Plugin resolver previews فقط.
- Synthetic identifiers لاختبار non-enumeration.
- Positive controls على موارد tenant معروفة.
- Support audit event append لتسجيل الأدلة.

لم يتم تنفيذ:

- أي provider request.
- أي repository mutation.
- أي database query.
- أي SSH command.
- أي device install أو pairing.
- أي credential retrieval أو secret display.
- أي invitation/member mutation.
- أي connection revoke أو policy update.
- أي dispatch لنتيجة resolver حتى عندما كانت `dispatch_ready`.

---

## 3. الحالة التشغيلية الحالية

### Workspace وActivation

- Workspace يعمل في **Managed mode**.
- حالة onboarding تظهر healthy.
- يوجد جهازان مسجلان ومفعّلان.
- النظام يوصي بعدم إعادة تثبيت جهاز تلقائيًا.
- Local Manager هو المسار المرئي لإدارة الأجهزة، لكن health/device APIs نفسها غير قابلة للاستخدام عبر User JWT.

### الاتصالات

يوجد 7 اتصالات tenant-visible:

- 3 Remote SSH: `active / pending_validation`
- 2 Remote MySQL:
  - واحد `pending_validation`
  - واحد `promoted_to_platform_secrets` لكن `last_validated_at = null`
- WordPress: `active / pending_validation`
- Sample CRM: `active / metadata_only`

**لا يوجد اتصال runtime-relevant مثبت أنه fully validated.**

### النتيجة العملية

- `status: active` يثبت وجود السجل والبيانات اللازمة فقط.
- لا يثبت provider validation.
- لا يثبت runtime readiness.
- لا يثبت execution permission.

---

## 4. الضوابط التي تم إصلاحها أو ثبت نجاحها

### Admin exposure containment

تم تأكيد إصلاح منع tenant principals من الوصول المباشر إلى:

- `admin_platform_tool`
- admin-scoped `platform_endpoint_export`
- admin-scoped `virtual_tool`
- admin credential-status/intake/create bindings

النتيجة الحالية:

```text
admin_tool_forbidden
will_execute: false
credential lookup: not attempted
```

### Selector controls

- طلب `action_key` و`tool_key` معًا أصبح مرفوضًا بـ`ambiguous_capability_selector`.
- whitespace-only selector يتم تطبيعه قبل التقييم.
- cross-plugin binding lookup يبقى plugin-scoped ولا يحدث global fallback.

### Connection validation gates

- `pending_validation` أصبح غير قابل للاستخدام للتنفيذ.
- `metadata_only` أصبح غير قابل للاستخدام للتنفيذ.
- CRM scope غير المدعوم أصبح يُرفض قبل lookup.
- Managed/Dedicated credential fallback أصبح أكثر صرامة في عدة مسارات.

### Object-level authorization

نجحت اختبارات non-enumeration على Connection status وCredential-intake status وWorkspace members وWorkspace brands وInvitations وAccess requests. Unknown identifiers أعادت أخطاء عامة بدون كشف metadata.

### Binding lifecycle

- Pending bindings عبر state-changing وdiagnostic وread-only بقيت fail-closed.
- `plugin_not_found` أصبح fail-fast.
- Explicit missing binding لا ينفذ credentials أو provider calls.

### Tool-path risk classification

في Remote SSH، `restart_app` و`deploy_pull` يتطلبان approval بينما `probe` read-only لا يتطلب approval. هذا يثبت أن approval engine موجود، لكن metadata ليست متسقة في كل plugins.

---

## 5. المشكلات الحرجة المفتوحة — P0

### 5.1 Missing-selector وplugin-definition-only fail-open

في موجات سابقة ضمن نفس الحملة، عدم إرسال action/tool selector أدى إلى auto-selection لأول binding و`dispatch_ready` و`will_execute: true` مع suppression للـsmoke والapproval بسبب `no_action_requested`. كما أن plugins بدون executable bindings أعادت `binding status: plugin_definition_only` و`will_execute: true`.

**الخطر:** Request ناقص أو malformed يمكن أن يرث capability لم يطلبها المستخدم.

**الإصلاح المطلوب:** فرض XOR لselector واحد فقط وغير فارغ، إعادة `missing_capability_selector` عند غيابه، جعل `plugin_definition_only` hard non-executable، ومنع implicit first-binding selection.

### 5.2 Action-path authorization وaction/tool parity

تم إثبات حالات state-changing مثل support-ticket lifecycle record وads governance snapshot record وsession insight backlog apply. على action path كانت `approval_required: false` مع غياب agent validation وadmin surface denial، بينما tool path لنفس capability كان `admin_platform_tool`, `exposure_scope: admin`, `binding_role: state_changing`, `admin_tool_forbidden`, و`approval_required: true`.

**الخطر:** تغيير selector surface يغيّر authorization policy لنفس capability.

**الإصلاح المطلوب:** Canonical capability policy واحدة لكل action/tool pair، تطبيق policy الأشد على كل surfaces، ومنع النشر إذا اختلف risk class أو exposure أو approval أو skill أو smoke أو target authority.

### 5.3 Action canonical validation fail-open

تم قبول arbitrary action وaction من plugin آخر وuppercase/case-mismatched action مع `canonical_policy.ready: true` و`action_binding_not_found`.

**الخطر:** canonical metadata لا يمكن الاعتماد عليها لاتخاذ قرار approval أو audit.

**الإصلاح المطلوب:** التحقق من `(plugin_key, normalized_action_key, version)`, رفض arbitrary وcross-plugin actions قبل downstream evaluation، وإعادة `action_not_registered`.

### 5.4 Agent identity وsubject authorization

Missing، malformed، unregistered، وvalid agents حصلوا على نفس القرار في عدة action paths. لم يظهر format validation أو existence check أو tenant ownership أو revoked/disabled state أو validated subject evidence، وفي بعض الحالات حدث credential lookup قبل agent validation.

**الخطر:** Approval أو smoke أو credential resolution يمكن أن يتم دون subject موثوق.

**ترتيب البوابات المطلوب:** Validate agent format → Resolve agent record → Validate tenant ownership → Validate active/revoked state → Resolve skills/grants → Resolve credentials → Resolve smoke/approval.

### 5.5 Credential-scope isolation وconnection provenance

Remote SSH أظهر أن `user_connection` و`tenant_connection` اختارا الاتصال نفسه، ولا يوجد دليل أنه tenant-scoped. `platform_managed` أظهر نفس row count رغم اختيار platform default، ولا توجد حقول provenance.

**الإصلاح المطلوب:** إرجاع `requested_scope`, `normalized_scope`, `selected_scope`, `connection_owner_scope`, `selection_policy`, `eligibility_reason`, و`fallback_used`. لا يستخدم user connection كـtenant connection بدون promotion/delegation record صريح.

### 5.6 Smoke certificate binding غير مكتمل

نفس شهادة CRM ظهرت مع scope صحيح ومرفوض وmalformed agent وحالة بدون اختيار connection. الشهادة لا تعرض action key أوbinding ID أوconnection ID أوcredential scope أوagent ID أوtenant/authorization policy versions.

**الإصلاح المطلوب:** ربط الشهادة بـplugin/action/binding revision وendpoint/method/origin وcredential scope وconnection class/ID وagent/subject type وpolicy versions وenvironment، مع الفصل بين transport certification وcredential validation وresource validation وexecution authorization.

---

## 6. المشكلات المرتفعة — P1

### 6.1 Manifest-to-runtime contract drift

Actions معلنة لكنها غير مربوطة: WordPress `wordpress_rest.read_users`, Google Ads `list_campaigns`, Google Analytics `run_report`, Custom API `call_api`, ومن مراجعات سابقة Drive `list_files` وGitHub `list_repos`.

**المطلوب:** Alias table versioned، publication-time validation، ومنع plugin publication إذا default action لا يحل إلى binding نشط.

### 6.2 Pagination وfilters في Connect wrappers — موجة 29

`connect_app_integrations_list`: requested limit 1, returned 32, app/status filters ignored.  
`connect_app_connections_list`: requested limit 1, returned 7, app/status filters ignored.  
لا توجد `has_more`, `next_cursor`, `applied_filters`, أو`ignored_filters`.

**المطلوب:** Strict tool args schema، رفض unknown fields، canonical paginated projection، وpagination metadata.

### 6.3 listTools logical pagination — موجة 30

`total_count: 106`, `returned_count: 50`, `has_more: true`, `next_cursor: 50`، لكن `listTools` لا يقبل cursor. `response_chunk_read` يقرأ نص الصفحة الأولى ولا يجلب الصفحة المنطقية الثانية.

**المطلوب:** إضافة cursor وlimit، الفصل بين response text chunking وlogical pagination، وتوفير tenant-resolved complete tool inventory.

### 6.4 Support ticket lifecycle materialization — موجة 31

التذكرة الرئيسية بقيت `priority: normal`, `severity: sev3`, `status: open`, `lifecycle: triage_pending`, `assigned_to: null`, و`sla_status: on_track` رغم أحداث P0 ومواعيد منتهية. Header timestamps متوقفة عند 12 يونيو 2026، وتوجد تذكرتا simulation داخل production queue.

**المطلوب:** تحديث timestamps عند كل event، حساب effective priority/severity، إعادة حساب SLA، auto-escalation، فصل simulation queue، وcompact event pagination.

### 6.5 Capability registry/runtime split — موجة 32

الـlive registry يعلن `local_manager`, `database_readiness`, و`tenant_evolution` كـactive، لكن `me_capabilities` يعرض 4 capabilities فقط وEffective preview يعيد `CAPABILITY_NOT_REGISTERED`.

**المطلوب:** مصدر حقيقة واحد تستخدمه Docs و`me_capabilities` وeffective preview و`listTools` وroute authorization وoperating guide.

### 6.6 Tenant catalog exposure — موجة 34

Tenant catalog يعرض 32 plugin تشمل fixtures وinternal/admin orchestration وplatform-only bridges وsample CRM وundelegated beta plugins.

**المطلوب:** Tenant-resolved catalog يستبعد افتراضيًا fixture/test وinternal/admin وplatform-only bridges وmock providers وundelegated beta plugins وbindings غير الجاهزة.

### 6.7 Device/local route mismatch

الأدوات معلنة tenant-safe وJWT-derived، لكنها تعيد `admin_backend_api_key_required` في local connector device inventory وhealth وlocal gateway tools list.

**النتيجة:** لا يمكن إثبات device ownership أوonline state أوconnector attestation أوhostname match أوlocal consent أوUAC/local approval.

### 6.8 Activation graph isolation

Readbacks ما زالت تحتوي مراجع لكيانات خارج tenant الحالي.

**المطلوب:** تصفية graph context إلى tenant/user/devices/policies/assets المصرح بها فقط وعدم استخدام graph hints كauthority.

---

## 7. المشكلات المتوسطة — P2

### 7.1 Identifier format validation

Malformed وunknown IDs يعيدان نفس not-found أوmembership denial. المطلوب stable generic code مثل `INVALID_IDENTIFIER_FORMAT` مع الحفاظ على non-enumeration.

### 7.2 Beta lifecycle transparency

`status: beta` لا يظهر كauthorization stage. المطلوب `beta_allowed`, `policy_source`, `accepted_by`, `accepted_at`, `policy_version`, `expires_at`, و`revoked_at`.

### 7.3 Readiness semantics

Database status قد يعيد `ready: true` مع `pending_validation` أو`promoted_to_platform_secrets`, و`last_validated_at: null`, و`execution_enabled: false`, و`blocked_reasons: []`.

**المطلوب:** فصل `record_ready`, `credentials_present`, `credential_promoted`, `network_reachable`, `authenticated`, `live_validation_passed`, `runtime_ready`, و`execution_enabled`.

---

## 8. الموجات 29–34 — النتائج النهائية

| الموجة | المحور | النتيجة |
|---|---|---|
| 29 | Connect pagination/filters | فشل |
| 30 | listTools logical pagination | فشل |
| 31 | Support lifecycle materialization | فشل |
| 32 | Capability registry/runtime consistency | فشل |
| 33 | Agent/grant subject consistency | فشل |
| 34 | Tenant catalog exposure | فشل |

لم يحدث أي تنفيذ أو mutation أثناء هذه الموجات.

---

## 9. المحاور المحجوبة بعقد المنصة

### 9.1 Disabled/deprecated lifecycle

غير قابل للاختبار لأن tenant catalog لا يقبل `include_inactive`.

### 9.2 Device health/ownership/consent

محجوب لأن المسارات تطلب admin/service credentials بدل User JWT.

### 9.3 Explicit connection pinning

Resolver input لا يوفر `connection_id` لاختيار connection بعينه، لذلك لا يمكن إثبات explicit binding أوsafe deterministic selection.

---

## 10. قرار الإصدار

| المجال | القرار |
|---|---|
| Tenant read-only status | مقبول مع التحفظات |
| Object-level tenant isolation | جيد في المسارات المختبرة |
| Admin tool containment | تحسن واضح ومقبول حاليًا |
| State-changing action path | غير جاهز |
| Agent authorization | غير جاهز |
| Credential scope isolation | غير جاهز |
| Smoke certification trust | غير جاهز |
| Local connector / Local Gateway | غير جاهز |
| Capability discovery | غير جاهز |
| Support operations | غير جاهز |
| Catalog publication integrity | غير جاهز |

### القرار النهائي

لا يُنصح بإطلاق tenant execution العام أو توسيع state-changing capabilities قبل إغلاق P0.

يمكن الإبقاء مؤقتًا على read-only status routes وresolver preview وnon-enumerating tenant reads وsecure credential intake UI وfail-closed explicit tool paths، مع إبقاء جميع execution paths غير المعتمدة مغلقة.

---

## 11. خطة الإصلاح ذات الأولوية

### P0 — قبل أي إطلاق تنفيذي

- Hard fail عند missing/empty selector.
- Canonical plugin-scoped action registry.
- Canonical capability policy واحدة لكل action/tool pair.
- Agent format/existence/tenant ownership gate قبل credentials.
- Credential-scope strict isolation وprovenance.
- Smoke certificates مربوطة بالsubject/connection/scope/policy.
- State-changing semantic classification إلزامية.
- Invalidating existing smoke certificates عند تغيير authorization policy.

### P1 — قبل إطلاق tenant operations

- توحيد capability registry.
- إصلاح `listTools` pagination.
- تطبيق filters/pagination في connect wrappers.
- إصلاح support ticket materialization وSLA.
- Tenant-resolved catalog.
- إصلاح JWT routing لـLocal Connector/Gateway.
- تصفية activation graph.
- إضافة explicit connection pinning.

### P2 — تحسين العقود والوضوح

- Identifier format contracts.
- Beta lifecycle evidence.
- Readiness field renaming.
- Minimal fail-fast response envelopes.
- Compact audit/event pagination.

---

## 12. سجل الأدلة

### التذكرة الرئيسية

`3c8d16a0-2923-4065-934b-3e9e75382a4e`

### أحداث الموجات 1–28

`d4576465-be96-4df0-aa7a-57ca029f353c`  
`8fb79120-b12d-4c02-a896-f611a1f08f26`  
`ca36987d-50d5-43e6-98fe-bb6173b89d45`  
`1075aa07-4b0b-4ad5-a438-7c0db70347d7`  
`4b25836a-f063-4fe3-93e2-bab73c030b86`  
`1fa4f038-15cb-4b7f-ab76-453ef5a39cdf`  
`0a74dedc-a9eb-4c82-8af5-547cf17a1e38`  
`f6448abd-a240-49d0-9974-264de35ba9bf`  
`77444d05-16a5-4642-b61e-976ffb02c712`  
`c89a9da2-6c26-4b8a-9bbd-64d5b0b6c1f7`  
`4af843ab-1ae3-485c-a236-d32ff560edd2`  
`855955ae-c4bc-4cf1-b3d6-2099e044e040`  
`5e7054c0-dd8b-4345-842c-be5b33141339`  
`a896204e-43eb-469e-b8dc-9d04312d5ae6`  
`fab2699e-0e19-42a4-bffb-1cfd9e566e51`  
`707eb4db-73a6-4df0-a3d3-fb1eb3cb3d62`  
`1abe8605-5283-40e6-be30-978ec3a008a3`  
`f7faab20-1f07-4c1f-a9f2-54f4b4399fd7`  
`c12e9463-5582-44a8-83f3-b1625e5e9509`  
`15c4c011-fdf5-4474-8510-59f00307d56c`  
`a111d7c6-8390-4f75-bb3d-6608d08455af`  
`6b275649-f7b3-4968-ae6f-97064dd3cdef`  
`eb9c72be-7a35-4aa7-9091-1f1215f0c765`  
`dadeff73-bd83-466b-98b0-0f26c0dfa858`  
`acd2ebf0-6515-4ed2-8eb5-206e733614ff`  
`8406d2f5-8467-4a82-a0d6-9b05442e9643`  
`a8b2b021-3de4-4929-9b5a-e822bd60bb8a`  
`97b167d7-3ee5-470d-be6a-857b2ede1820`

### الحدث الموحّد للموجات 29–34 والملحق المحجوب

`28213bb6-be87-4212-8dad-21cc07edd44d`

---

## 13. إقرار السلامة

- Actual execution: **NO**
- Provider calls: **0**
- Database queries: **0**
- SSH commands: **0**
- Repository mutations: **0**
- Device installs: **0**
- Credential secrets returned: **NO**
- Connection mutations: **0**
- Invitation/member mutations: **0**

> هذا الإقرار يصف موجات tenant reverification الواردة في هذا التقرير فقط، ولا يصف أعمال صيانة المستودع اللاحقة التي تتم عبر مسارات إدارية محكومة.
