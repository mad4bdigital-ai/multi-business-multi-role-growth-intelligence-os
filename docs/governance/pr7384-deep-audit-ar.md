# التدقيق العميق للباتش المجمع PR #7384

## النطاق

يراجع هذا التدقيق علاجات AutoPilot وStaging وActivation Gateway وProduction promotion وHostinger R7 وgenerated artifacts وGitHub Actions. لا يجيز هذا الملف أي نشر Production أو provider mutation؛ جميع readbackات Production يجب أن تبقى GET-only.

## مصفوفة الأسباب الجذرية

| المعرّف | المشكلة المرصودة | السبب الجذري | الإصلاح الدائم | اختبار القبول | الحالة |
|---|---|---|---|---|---|
| G-01 | `action_required` مع jobs فارغة على عدة workflows | GitHub يوقف workflows المحمية قبل إنشاء jobs، لذلك لا يمكن اعتبارها نجاحاً أو فشلاً فنياً | توثيق approval boundary، وتقليل workflows المطلوبة إلى authoritative checks، وربط workflow_call حيث يلزم | لا توجد `action_required` على الرأس النهائي، أو يوجد receipt صريح للموافقة | مفتوح خارجياً |
| G-02 | inventory/evaluation يتغيران تلقائياً بعد الدفع | generated-artifact writer يعمل بعد push ويخلق رأساً جديداً، ما يبدّل exact SHA ويعيد تشغيل CI | جعل generation جزءاً من writer محكوم قبل إنشاء PR، أو جعل post-push refresh يعيد CI على الرأس الجديد تلقائياً مع CAS | inventory/evaluation check أخضر على نفس الرأس الذي سيُراجع | قيد المعالجة |
| G-03 | E2E `feature_change_missing_e2e_phase_contract` وruntime coverage | عقود E2E لا تتغير مع test/runtime files الجديدة | تحديث `scope.include` و`evidence_paths` و`tests` داخل العقد نفسه ثم تشغيل evaluator على commit الناتج | evaluator المحلي يخرج `findings=[]` | عولج محلياً |
| G-04 | Work Map/Derived State stale بعد generated refresh | writers متعددة تنتج artifacts مشتقة بترتيب غير ذري | release recipe واحد يكتب artifacts ويعيد فحصها قبل الدفع؛ منع أي writer متوازٍ على نفس الرأس | Work Map وDerived State convergence على exact SHA | مفتوح/يتطلب writer |
| G-05 | R7 يعيد 503 رغم نجاح Git/CI | Hostinger runtime activation غير مثبت أو لا يقدم SHA/branch المتوقع؛ R7 لا يملك build/deploy evidence كافياً | post-merge reconciler بمهلة محددة يربط build evidence بـProduction SHA ثم يشغّل R7 تلقائياً؛ لا يعلن Current عند 503 | `/health`, `/version`, `/deployment-info`, `/connector-agent-version` كلها 200 وتطابق SHA وProduction | مفتوح تشغيلياً |
| G-06 | R7 يبدأ من issue comment فقط | `issue_comment` مع author-id ثابت، ولا يوجد push/workflow_run trigger تلقائي | إضافة trigger موثوق من protected Production push أو workflow_run، مع exact SHA وCAS وidempotent session | دمج ناجح يبدأ readback بلا تعليق يدوي | مفتوح داخل PR متابعة |
| G-07 | نقص `TENANT_GPT_SSO_SIGNING_SECRET` في Production preflight | startup contract لا يمنع promotion قبل فحص secret presence | preflight يتحقق من وجود secret metadata فقط دون قراءته، ويصنف `blocked_secret_contract` | deployment لا يبدأ عند غياب secret، ولا يظهر secret payload في evidence | قيد التدقيق |
| G-08 | AutoPilot كان يحتاج إصلاحات يدوية على Windows | env defaults وempty-secret replacement وbackup quarantine لم تكن جزءاً من المسار | دمج exact-SHA، protected-file guard، backup quarantine خارج repo، local-only secret generation، host defaults وInteractive logon | تشغيل Zero Click من External SSD بعد clean tree | عولج في PR |
| G-09 | Production/Staging authority mixing risk | عدة workflows وgenerated writers تتعامل مع main/Production دون state machine موحدة | promotion_session_id مشتق من repository/release-cut/pinned Production SHA، مع CAS قبل كل mutation وفصل certifier/merger/reconciler | أي ref movement يؤدي إلى Blocked وطلب تفويض جديد | قيد التصميم |
| G-10 | الفحوص العرضية تختلط بالدليل السلطوي | عدد كبير من workflows العامة يظهر بجانب بوابات الترقية | check سلطوي واحد `Governed Production Promotion / Ready` يضم receipts للبوابات السلطوية فقط | قرار الترقية لا يعتمد على check غير مسجل | قيد التصميم |

## قواعد عدم التخفيف

لا يستخدم هذا الإصلاح `force-push` أو `reset --hard` على عمل المستخدم، ولا يقرأ credential payloads، ولا يشغّل SQL migrations، ولا ينفذ Cloudflare/Hostinger mutation داخل readback. لا تعتبر حالة `action_required` نجاحاً، ولا تعتبر 503 دليلاً على أن Production Current.

## قرار التقدم

لا يُطلب Owner Gate على رأس جديد قبل استقرار generated artifacts وCI. أي تحديث آلي للرأس يلغي التفويض السابق. Production لا تُعلن Current إلا بعد R7 ناجح يثبت HTTP 200 والـSHA والـbranch، مع إبقاء `provider_mutation=false` و`database_mutation=false`.

## خطة الإصلاح

يبدأ الإصلاح بإغلاق E2E وgenerated convergence، ثم معالجة workflow approval boundary وpost-push refresh idempotency، ثم إضافة Production preflight وR7 push/workflow_run reconciler. بعد ذلك فقط يعاد تقييم Owner Gate وmergeability. لا يُنفذ نشر Production أثناء مرحلة التدقيق.

## الحالة الحالية الموثقة

رأس PR #7384 الأخير عند بدء التدقيق هو `1b3109d5345cc25330cb67029a33478a7c41eb7c`. الرأس المحلي متزامن مع الفرع البعيد. ظهرت workflows كثيرة بحالة `action_required` مع `jobs=[]`، وهي حالة حوكمة/صلاحية تشغيل وليست دليلاً على نجاح فني.

