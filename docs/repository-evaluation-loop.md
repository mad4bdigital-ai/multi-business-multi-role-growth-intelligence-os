# Repository Evaluation Loop

## الهدف

تضيف هذه الطبقة تقييمًا ديناميكيًا فوق `Repository Inventory`. يبقى الجرد مصدر الحقيقة الخاص بمحتويات المستودع، بينما يحوّل التقييم نتائج الفحوص الحالية إلى فجوات قابلة للتتبع، مع دليل ودرجة خطورة وحالة وقرار بوابة واضح.

## حلقة التحقق

تعمل الحلقة على مراحل ثابتة وقابلة لإعادة التشغيل:

1. قراءة الحالة من Git index وملفات الجرد والاعتماديات وWorkflows.
2. إجراء preflight للتبعيات التنفيذية؛ إذا غابت أدوات `jest` أو `tsc` بعد clone نظيف، تُعلن الحالة `not-evaluated` مع توصية `npm ci` بدل تصنيف فشل بيئي كفجوة جودة.
3. تشغيل فحوص محددة بمهلة زمنية وتسجيل نتيجة كل فحص، دون تضمين الأسرار أو المخرجات الحساسة.
4. تحويل النتائج إلى فجوات ذات معرّفات مستقرة مبنية على المجال والقاعدة، لا على ترتيب التنفيذ. ويشمل ذلك فحص SHA pinning لمراجع Actions، وحالة اقتراب سطح CI من حد التحذير.
5. عند توفير baseline، تُقارن الفجوات الحالية بالنسخة السابقة ويُنتج تقرير lifecycle منفصل يميز `new` و`unchanged` و`persisting` و`resolved`. لا تُحقن نتيجة توفر baseline في artifacts committed، لأن PR يملك baseline من base SHA بينما push إلى `main` لا يملكه.
6. إعادة بناء artifacts committed من المدخلات الحالية فقط والتحقق من تطابقها؛ أي اختلاف يعني أن التوليد غير deterministic. يبقى تقرير baseline منفصلًا وقابلًا للرفع كدليل CI دون تغيير ملفات `docs/repository-evaluation.*` الملتزمة.
7. إصدار قرار البوابة. مع `--enforce` يفشل CI فقط عند فجوة blocking مفتوحة أو فشل فحص حاجز، بينما تبقى الفجوات التحذيرية ظاهرة دون منع الدمج. يظل التقييم المحلي deterministic، في حين يملك CI probes شبكية وبيئية منفصلة للتحقق من dependency advisories و.NET SDK.

## مصدر الحقيقة

المصادر المقبولة هي `git ls-files`، `docs/repository-inventory.json`، `package.json` وملفات `package-lock.json`، ملفات Workflow، ونتائج الأوامر التي يعرّفها العقد. لا تُستخدم قوائم مسارات ثابتة لتحديد حجم المستودع أو مكوناته.

## نموذج الفجوة

كل فجوة تحتوي على `gapId` ثابت، و`domain`، و`severity`، و`status`، و`lifecycle`، و`evidence`، و`impact`، و`recommendation`. الحالات التشغيلية هي `open`, `resolved`, `not-evaluated` و`informational`. دورة الحياة هي `new`, `persisting`, `resolved`, `unchanged`.

## المجالات الحالية

يغطي الإصدار الأول سلامة الجرد والتقارير المولدة، typecheck والاختبارات الأساسية، انجراف Workflows، SHA pinning لمراجع Actions، الاعتماديات، توفر أدوات البناء، الملفات الكبيرة ومؤشرات الصيانة، والحالة العامة لبوابة CI. يعتمد حجم سطح CI على `docs/repository-ci-surface-policy.json` مع حد warning مبكر وفحص `automation-overlap-analyzer`، بينما تعتمد الملفات الكبيرة على `docs/repository-large-file-policy.json` التي تتطلب مبررًا ومالكًا لكل ملف مستثنى. يمكن إضافة قواعد جديدة دون تعديل schema الأساسي.

## حدود الأتمتة

التقييم لا يطبّق ترقيات اعتماديات أو تغييرات كود أو تعديلات صلاحيات تلقائيًا. الإصلاحات التي تغيّر سلوك المشروع تبقى توصيات مرتبطة بالفجوة، بينما تُعالج المخرجات المولدة وstale artifacts بواسطة أوامر التوليد القياسية.

## المخرجات

ينتج المحرك `docs/repository-evaluation.json` كمصدر آلي، و`docs/repository-evaluation.md` كتقرير قابل للقراءة، و`docs/repository-evaluation-summary.json` كملخص منخفض الضوضاء. يجب أن تكون جميعها deterministic بالنسبة إلى الحالة المدخلة ونتائج الفحوص المحلية، وأن تبقى مستقلة عن وجود baseline خاص بحدث PR. ويُظهر التقرير عدد مراجع Actions غير المثبتة، وحالة سعة CI (`within-budget`, `near-limit`, `exceeded`) حتى تكون الزيادة المستقبلية قابلة للرصد قبل بلوغ حد المنع. probes الخارجية اختيارية محليًا: `--include-network` لفحص advisories و`--include-environment` لفحص SDK، بينما يفرض Workflow البعيد audit الشبكي و`setup-dotnet@v5` عبر `docs/repository-dependency-audit-policy.json`. ينتج `--diff --baseline <path>` تقرير lifecycle مستقلًا يرفع في CI ولا يكتب إلى artifacts committed.

## سياسة الدمج

يجب أن يمر Pull Request عبر `evaluation:check -- --enforce` و`evaluation:test`، وأن يثبت أن التقرير متسق مع الجرد الحالي. يجب أيضًا أن ينجح فحص overlap وnetwork dependency audit و.NET SDK probe في Workflow البعيد، وأن يرفع CI ناتج `--diff --baseline` كتقرير lifecycle منفصل. لا يمنع التقرير الدمج بسبب فجوة معلوماتية وحدها، لكنه يعلنها ويحتفظ بدليلها حتى لا تختفي من المتابعة. الوضع الافتراضي لا يستدعي binary `dotnet`؛ وعند وجود عقد `setup-dotnet` موثق يصنف البيئة كـ `contracted`، بينما يبقى probe المحلي opt-in.
