# مصفوفة إغلاق حوكمة المستودع

## الغرض

توثق هذه المصفوفة حالة حوكمة المستودع بعد دمج PR #7452، وتفصل بين **الإغلاق المصدرّي القابل للتحقق في CI** وبين **التفعيل الحي خارج المستودع**. وجود سياسة في Constitution أو في controller لا يُعد دليلاً على تطبيقها فعلياً في GitHub؛ الدليل الحي يتطلب دورة readiness وauthorization وapply وsame-cycle readback منفصلة.

## الحالة الحالية

| المجال | الحالة المصدرية | دليل التحقق | الحد المتبقي |
|---|---|---|---|
| Constitution وpolicy registry | مغلق مصدرّياً | `http-generic-api/config/repository-governance-constitution.json` و`.github/governance/policy-registry.json` | لا تُستنتج منهما حالة GitHub الحية |
| Main وProduction activation lifecycle | generic في المصدر | `.github/ops/github-main-review-policy-live-activation.mjs` و`http-generic-api/scripts/github-review-policy-target.mjs` | يحتاج Apply حي لكل فرع بتفويضه الصريح |
| Two-branch server readback | مغلق مصدرّياً | `.github/ops/github-repository-policy-readback.mjs` و`test-github-repository-policy-readback-core.mjs` | يبقى drift قائماً حتى يثبت GitHub `protected=true` وchecks صحيحة |
| Semantic facet → verifier closure | مغلق مصدرّياً | `.github/governance/semantic-verifier-requirements.json` و`semantic-verifier-bindings.json` | التحليل الحالي file/import/regex؛ ترقية AST/symbol/effect تحسين لاحق |
| Executable universe | مغلق مصدرّياً | `.github/governance/executable-validator-registry.json` و`repository-governance-fixed-point.mjs` | يتطلب توفر binaries في بيئة CI؛ النقص يفشل مغلقاً |
| Test/invariant authority | مغلق مصدرّياً | `.github/governance/test-authority-registry.json` وfixed-point tests | حذف آخر test authority يفشل مغلقاً |
| Workflow surface ratchet | حاكم مصدرّياً | `docs/repository-ci-surface-policy.json` و`repository-governance-closure.mjs` | يجب خفض العدد نحو 160 دون نمو جديد |
| Repository Evaluation budget compatibility | عولج في هذه الدفعة | `scripts/repository-evaluation.mjs` و`test-repository-evaluation.mjs` | لا توجد سلطة ثانية؛ `targetMaxWorkflowFiles` هو canonical |
| Repository Inventory/Evaluation artifacts | observability | `repository-inventory-verification-gate.mjs` و`repository-evaluation.yml` | النشر بعد الدمج فقط، ولا يدخل feature PR كـmutation |

## حدود التفعيل الحي

لا ينفذ هذا PR أي Ruleset Apply أو protected-ref mutation. قبل التفعيل الحي يجب تثبيت SHA الفرع المستهدف، التحقق من policy fingerprint وtrusted GitHub App identity، والحصول على authorization envelope مستقل. بعد Apply واحد فقط يجب تنفيذ readback من GitHub نفسها وإثبات:

```text
main.protected = true
main.required_check = Derived State Closure
Production.protected = true
Production.required_check = Governed Production Promotion
server_policy_drift_count = 0
```

كما يجب أن يظل direct push وforce push محظورين، وأن يكون bypass فارغاً وفق Constitution. فشل readback أو غياب App producer binding يعني أن enforcement ما زال `degraded` حتى لو نجحت كل فحوصات المصدر.

## Definition of Done

يُعد الإغلاق المصدرّي ناجحاً عندما تكون metrics الحاكمة التالية صفراً: unknown surfaces، unknown executables، unknown semantic executables، unresolved semantic dependencies، dangling deletion references، uncovered semantic impacts، missing required verifiers، unregistered tests، unvalidated executables، derived missing dependencies، derived cycles، policy registry errors، semantic registry errors، workflow surface growth، وcandidate identity mismatch.

ويُعد الإغلاق التشغيلي ناجحاً فقط بعد تحقق GitHub الحي من حماية `main` و`Production` ومن required-check producer identity، ثم تسجيل readback موثوق في نفس دورة التفعيل. لا يجوز استخدام observability artifacts أو repository evaluation output لإثبات server enforcement.

## References / المراجع الداخلية

1. [Constitution](../../http-generic-api/config/repository-governance-constitution.json)
2. [Semantic verifier requirements](../../.github/governance/semantic-verifier-requirements.json)
3. [Verifier registry](../../.github/governance/verifier-registry.json)
4. [Test authority registry](../../.github/governance/test-authority-registry.json)
5. [Repository governance closure](../../scripts/repository-governance-closure.mjs)
6. [Repository governance fixed point](../../scripts/repository-governance-fixed-point.mjs)
7. [Repository evaluation](../../scripts/repository-evaluation.mjs)
8. [GitHub policy activation lifecycle](../../.github/ops/github-main-review-policy-live-activation.mjs)
