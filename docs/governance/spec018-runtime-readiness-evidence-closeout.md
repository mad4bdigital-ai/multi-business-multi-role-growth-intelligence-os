# حزمة إغلاق أدلة الجاهزية التشغيلية لـ Spec018

## الغرض

تضيف هذه الحزمة عقدًا موحدًا لإغلاق أدلة **Runtime Readiness** في Spec018 دون تحويل وجود ملفات migration أو عقود المصدر إلى ادعاء بأن البيئة الحية قد تمت ترقيتها. فهي تربط رأس المصدر المتوقع بالرأس المرصود، وتطلب أدلة مستقلة للهويات الثلاث: قاعدة Runtime، وقاعدة Governance، وقاعدة Runtime Persistence، ثم تفصل جاهزية Staging عن صلاحية Production.

> **قاعدة الحزمة:** نجاح العقد يعني أن الأدلة المقدمة صالحة للمراجعة، ولا يعني أن migration طُبقت أو أن قاعدة بيانات تغيرت أو أن Production فُعّلت.

## ما يثبته العقد

يُصدر `runtimeReadinessEvidenceCloseout.mjs` تقريرًا حتميًا بالعقد `mad4b.spec018-runtime-readiness-evidence-closeout.v1`. ولا يصبح التقرير `ready_for_review` إلا إذا تحققت جميع الشروط التالية:

| البعد | شرط الإغلاق في العقد |
|---|---|
| هوية المصدر | تطابق `expected_sha` و`observed_sha` بصيغة SHA-1 كاملة، مع إعلان فرع المصدر |
| أدوار قواعد البيانات | وجود أدلة مستقلة للأدوار `runtime` و`governance` و`runtime_persistence` |
| schema وprivilege readback | اكتمال readback، وتطابق مصفوفة الصلاحيات، ونجاح فحص schema لكل دور |
| Staging | قابلية الوصول، وتطابق SHA، وclean readback، وجاهزية rollback rehearsal |
| CI | إشارة صريحة إلى نجاح كل checks المطلوبة |
| السلامة | بقاء migration apply وdatabase mutation وprovider call وProduction promotion وruntime transition activation معطلة |

يُنتج التقرير أيضًا بصمة أدلة SHA-256، ويمنع الحقول التي قد تحمل كلمات مرور أو رموز وصول أو مفاتيح خاصة أو بيانات اعتماد. ويظل `production` محجوبًا حتى عند نجاح كل أدلة Staging؛ فالحزمة لا تمنح صلاحية ترقية ولا تنفذ اتصالًا بقاعدة بيانات أو مزود خارجي.

## ما لا يثبته العقد

لا يثبت العقد أن migrations المصدرية طُبقت، ولا يثبت أن المستخدمين يملكون GRANT فعليًا في MariaDB، ولا يقرأ credentials، ولا ينفذ session smoke test على بيئة حية، ولا يفعّل Hard Activation أو Break-Glass، ولا يكتب إلى Hostinger أو Cloudflare أو Production. هذه الأدلة تحتاج مسارًا تشغيليًا محميًا وتفويضًا منفصلًا.

| خارج نطاق هذه الحزمة | المسار المطلوب لاحقًا |
|---|---|
| تطبيق migrations | نافذة تشغيل محكومة مع authorization وsame-cycle readback |
| منح الصلاحيات | least-privilege GRANT موثق ومراجع، ثم readback مستقل |
| إثبات الجداول الحية | Staging read-only probes للهويات الثلاث |
| اختبار الجلسات والكتالوج وchunks | smoke suite محمي على Staging، مع فصل فشل كل بعد |
| Production promotion | H11 ثم H12 بعد موافقة صريحة ومسار `main → Production` |
| إغلاق Spec018 النهائي | post-merge audit وclean redeploy وruntime-integrity readback |

## تشغيل الاختبار

يُدرج الاختبار في test manifest القياسي، ويمكن تشغيله من مجلد `http-generic-api` بالأمر التالي:

```bash
node test-runtime-readiness-evidence-closeout.mjs
```

الاختبار يغطي حالة الأدلة الفارغة، وحالة Staging الجاهزة للمراجعة، وفشل SHA أو privilege أو schema أو rollback، ومنع الأسرار والآثار الجانبية. كما يسجل عقد E2E في `.changes/e2e/spec018-runtime-readiness-evidence-closeout.json` دون تغيير `current_phase` في Spec018 أو تفعيل المراحل التشغيلية والإنتاجية.

## علاقة الحزمة بمهام Spec018

تدعم الحزمة انتقالًا مضبوطًا نحو **F09 وH06 وH10 وH11**، لكنها لا تضع علامة `[x]` على أي مهمة تتطلب أدلة بيئة حية. تبقى **H12** منفصلة تمامًا لأنها تتطلب موافقة صريحة على ترقية Production، ولا تُستنتج من نجاح CI أو من وجود migration في المستودع.

## حدود الأمان

لا تحتوي الحزمة على migration جديدة، ولا تنفذ SQL، ولا تستخدم credentials، ولا تنفذ grants، ولا تستدعي provider، ولا تدفع إلى فرع محمي، ولا تغيّر حالة runtime. وتمثل قيم `migration_apply_performed` و`database_mutated` و`provider_called` و`production_deployed` و`production_promotion_authorized` و`secrets_included` حدودًا صريحة تبقى `false` في مخرجات العقد.
