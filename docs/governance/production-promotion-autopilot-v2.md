# Production Promotion Autopilot v2

## الغرض

هذا العقد يعرّف عملية ترقية Production قابلة للاستئناف، حتمية الهوية، وfail-closed. لا يمنح العقد أي صلاحية merge أو deployment أو migration أو provider mutation؛ بل ينظم الأدلة والحواجز التي تسبق تلك العمليات.

## هوية العملية

لكل عملية promotion مفتاح ثابت:

```text
operation_id=promo-<release_cut_sha[0:12]>-<production_sha_before[0:12]>
```

ويُستخدم هذا المفتاح لإعادة استخدام release PR وvalidation PR وsupporting runs عند إعادة التشغيل. لا يجوز إنشاء candidate جديد إذا كانت العملية نفسها ما زالت مفتوحة والرؤوس لم تتحرك.

> إذا تحرك `main` أو `Production`، لا تُستأنف العملية القديمة. يجب إنشاء عملية جديدة بسبب `cas_inputs_changed` بعد تثبيت tuple جديد.

## حالات العملية

| الحالة | المعنى | الإجراء المسموح |
|---|---|---|
| `INTENT_CAPTURED` | التفويض وصل بصيغة صحيحة | قراءة refs فقط |
| `CAS_LOCKED` | تم تثبيت release cut وProduction قبل الترقية | لا mutation |
| `REQUEST_READY` | request PR tree-identical إلى main | انتظار Owner Gate |
| `OWNER_ATTESTED` | مراجعة المالك على exact head | تشغيل gates |
| `SUPPORTING_GATES_RUNNING` | الفحوص المساندة تعمل أو تحتاج موافقة GitHub | لا merge |
| `CERTIFICATION_RUNNING` | validation على exact candidate | لا merge |
| `CANDIDATE_READY` | evidence مكتمل وcandidate tree ثابت | يمكن تسليح merge envelope فقط |
| `MERGE_ARMED` | كل checks وCAS ناجحة | merge عبر PR فقط |
| `MERGED` | Production ref تغير إلى merge commit | بدء R7 |
| `R7_POLLING` | runtime يتأخر عن GitHub ref أو يستكمل الإقلاع | GET-only polling |
| `COMPLETED` | R7 يثبت runtime الحالي | حفظ evidence النهائي |
| `CAS_RESTART_REQUIRED` | ref تحرك أثناء العملية | إغلاق العملية دون mutation |

## Approval manifest

عند ظهور `action_required`، يجب أن ينشئ الـAutopilot artifact باسم `approval-manifest.json`، يحتوي على `operation_id`، وrun IDs، وروابط GitHub، ونطاق الموافقة. نطاق الموافقة المسموح هو `read_only_supporting_gate` فقط. لا تُقبل موافقة manifest كإذن merge أو deployment.

## Certified validation

لا يكفي أن يكون run على نفس candidate SHA إذا كان مرتبطاً بعملية أو validation PR مختلف. يجب أن يطابق الدليل:

```text
operation_id
validation_pr
candidate_sha
release_cut_sha
production_sha_before
```

ويجب أن تكون النتيجة `completed/success` قبل إصدار `CERTIFIED_RUN_ID`.

## R7 contract

R7 يستخدم GET-only probes على runtime العام، ويجب أن يفرق بين الحالات التالية:

| التصنيف | الإجراء |
|---|---|
| `production_current` | إنهاء ناجح |
| `runtime_activation_pending_or_sha_mismatch` | polling bounded دون إعادة promotion |
| `runtime_sha_current_branch_provenance_mismatch` | fail-closed وتصعيد |
| `oauth_discovery_not_ready` | polling bounded أو تصعيد حسب deadline |
| `trusted_ingress_attestation_required` | تصعيد آمن بلا secrets |

لا يجوز أن يقرأ R7 secrets أو يرسل POST/initialize أو يغير Cloudflare/Hostinger/DB. أي artifact يحتوي payload سرياً يُرفض.

## معايير الاستئناف

إعادة تشغيل نفس workflow بنفس inputs يجب أن تعيد استخدام surfaces الموجودة. إذا لم تكن العملية قابلة للاستئناف، يجب أن تكتب سبباً صريحاً في summary، مثل `operation_state_missing` أو `cas_inputs_changed` أو `validation_tuple_mismatch`.

## معايير القبول

يُعتبر Autopilot جاهزاً عندما يثبت الاختبارات أنه لا ينشئ PRs مكررة عند إعادة dispatch، ويرفض Owner Attestation على SHA قديم، ويجمع `action_required` في manifest واحد، ويرفض certified run من candidate مختلف، ويستأنف بعد crash، ويعالج تأخر Hostinger عبر R7 polling دون إعادة promotion، ويحافظ دائماً على `merge_executed=false` و`deployment_executed=false` حتى مرحلة merge المحكومة.
