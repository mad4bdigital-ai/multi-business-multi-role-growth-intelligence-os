# خطة تفكيك ملفات Canonical إلى مصادر قابلة للصيانة

**التاريخ:** 2026-04-26
**النطاق:** `system_bootstrap.md`, `direct_instructions_registry_patch.md`, `module_loader.md`, `prompt_router.md`
**الهدف:** تحويل الملفات الأربعة الضخمة إلى مصادر منظمة داخل `canonicals/`، ثم إعادة بناء ملفات الجذر تلقائيا عبر `build-canonicals.mjs`.

**تحديث التنفيذ:** تم اعتماد ملفات الجذر كـ lightweight generated indexes فقط، وليست concat كامل للمصادر. النصوص الكاملة والسلطة التحريرية تعيش داخل `canonicals/**`.

---

## 1. الملخص التنفيذي

الملفات الحالية تعمل كـ canonical runtime sources، لكنها أصبحت كبيرة جدا للقراءة والتعديل والمراجعة:

| الملف | الأسطر | الحجم التقريبي | المشكلة الأساسية |
|---|---:|---:|---|
| `system_bootstrap.md` | 5,630 | 247 KB | ملف bootstrap ضخم يصعب تحميل جزء منه فقط |
| `direct_instructions_registry_patch.md` | 4,229 | 171 KB | عدد كبير من قواعد governance في ملف واحد |
| `module_loader.md` | 3,722 | 161 KB | كتل تحميل واعتماديات طويلة ومتشابكة |
| `prompt_router.md` | 3,793 | 158 KB | routing وrepair وreview في ملف واحد |
| **المجموع** | **17,374** | **737 KB** | تحميل وتعديل ومراجعة مكلفة |

الحل المقترح:

1. إنشاء مجلد `canonicals/` كمصدر تحرير وحيد.
2. تقسيم كل ملف root إلى sub-files صغيرة ذات أسماء domain-aware.
3. إنشاء `build-canonicals.mjs` لإعادة دمج المصادر إلى ملفات الجذر.
4. إضافة `## Domain Index` أعلى كل ملف root لتوجيه الـ agents إلى الملف الفرعي المناسب.
5. اعتبار ملفات الجذر lightweight generated indexes، والكتابة اليدوية تكون داخل `canonicals/` فقط.

---

## 2. المعمارية المستهدفة

```text
canonicals/
  system_bootstrap/
    00_header_purpose.md
    01_logic_pointer_knowledge.md
    ...
    13_wordpress_publish_contract.md

  direct_instructions_registry_patch/
    00_header_purpose.md
    01_governance_foundation.md
    ...
    09_wordpress_publish_contract.md

  module_loader/
    00_header_purpose.md
    01_dependency_resolution.md
    ...
    04_wordpress_publish_contract.md

  prompt_router/
    00_header_purpose.md
    01_core_routing.md
    ...
    05_wordpress_publish_contract.md

build-canonicals.mjs

system_bootstrap.md
direct_instructions_registry_patch.md
module_loader.md
prompt_router.md
```

### قاعدة الملكية

- `canonicals/**` هو المصدر الحقيقي للتعديل.
- ملفات الجذر الأربعة هي ناتج بناء.
- أي تعديل يدوي في ملف root يجب نقله إلى الملف الفرعي المناسب قبل تشغيل build.
- `build-canonicals.mjs` يجب أن يكون deterministic: نفس المصادر تنتج نفس الملفات.

---

## 3. كيف يقل التحميل

بدلا من أن يقرأ agent ملفا حجمه 150-250 KB للوصول إلى قاعدة محددة، سيقرأ أول 60-120 سطر من `Domain Index`، ثم يفتح الملف الفرعي المناسب فقط.

مثال:

```text
المهمة: تعديل WordPress publish contract
بدلا من قراءة:
  system_bootstrap.md بالكامل: 247 KB
يقرأ:
  Domain Index: بضعة KB
  canonicals/system_bootstrap/13_wordpress_publish_contract.md
```

النتيجة المتوقعة:

- تقليل القراءة في المهام المتخصصة بنسبة 70-90%.
- مراجعة أسهل في Git diff.
- انخفاض خطر كسر قواعد بعيدة عن موضع التعديل.
- قابلية أفضل لإسناد العمل إلى أكثر من agent لاحقا.

---

## 4. التقسيم المقترح

### 4.1 `system_bootstrap.md`

العدد المقترح: 14 ملف مصدر.

| الملف الفرعي | النطاق التقريبي | الغرض |
|---|---:|---|
| `00_header_purpose.md` | 1-30 | عنوان الملف، الغرض، وأي ملاحظات افتتاحية |
| `01_logic_pointer_knowledge.md` | 31-263 | قواعد logic pointer وknowledge profile وbrand onboarding |
| `02_activation_transport.md` | 264-448 | activation transport، tool-first behavior، continuation override |
| `03_audit_logging_schema.md` | 449-744 | full audit، logging، parent actions، HTTP schema |
| `04_registry_foundation.md` | 745-1151 | Registry workbook، source of truth، routing، schema governance |
| `05_activation_runtime.md` | 1152-1442 | activation bootstrap، integrity، repairability، starter policies |
| `06_http_generic_api.md` | 1443-1597 | HTTP Generic API، endpoint registry، security constraints |
| `07_governed_additions_graph.md` | 1598-1727 | governed additions، graph intelligence، node/relationship registries |
| `08_google_workspace_runtime.md` | 1728-1918 | Google Workspace native actions وruntime validation dependencies |
| `09_growth_execution_authority.md` | 1919-2263 | growth feedback، authority model، workflow registry، binding integrity |
| `10_observability_repair.md` | 2264-3174 | observability، review surfaces، validation states، repair signals |
| `11_analytics_api_retirement.md` | 3175-3498 | analytics، API retirement، URL authority، tracking bindings |
| `12_runtime_validation_enforcer.md` | 3499-5290 | runtime validation enforcer، schema mandatory read، late enforcement |
| `13_wordpress_publish_contract.md` | 5291-5630 | WordPress publish contract runtime governance patch |

ملاحظات تنفيذ:

- القسم `12_runtime_validation_enforcer.md` كبير نسبيا، لكنه يمثل مجالا واضحا واحدا.
- يمكن لاحقا تفكيكه إلى `runtime_validation`, `schema_read`, `completion_lock` إذا زاد التعديل عليه.

### 4.2 `direct_instructions_registry_patch.md`

العدد المقترح: 10 ملفات مصدر.

| الملف الفرعي | النطاق التقريبي | الغرض |
|---|---:|---|
| `00_header_purpose.md` | 1-30 | عنوان الملف والغرض |
| `01_governance_foundation.md` | 31-496 | قواعد canonical presentation، brand core، activation، logging basics |
| `02_http_execution_logging.md` | 497-863 | parent action schema، auth routing، HTTP execution، logging surfaces |
| `03_registry_authority_schema.md` | 864-1151 | Registry source of truth، duplicate headers، runtime bindings، schema |
| `04_activation_policy_runtime.md` | 1152-1432 | activation bootstrap، integrity audit، provider continuity، scoring |
| `05_http_generic_api_additions.md` | 1433-1727 | HTTP Generic API، adaptive schema learning، governed additions، graph |
| `06_google_workspace_validation.md` | 1728-2015 | Google Workspace governance، runtime validation، growth feedback |
| `07_authority_binding_repair.md` | 2016-3174 | authority model، routes/chains، observability، repair، recovery |
| `08_analytics_wordpress_preflight.md` | 3175-3958 | analytics bindings، API retirement، URL migration، WordPress preflight |
| `09_wordpress_publish_contract.md` | 3959-4229 | WordPress publish contract direct instruction patch |

ملاحظة مهمة:

- النطاق `1474-1770` يحتوي تداخلا بين HTTP Generic API وGoogle Workspace وGraph governance. يجب مراجعته يدويا قبل القص النهائي حتى لا تنفصل قاعدة عن سياقها.

### 4.3 `module_loader.md`

العدد المقترح: 5 ملفات مصدر.

| الملف الفرعي | النطاق التقريبي | الغرض |
|---|---:|---|
| `00_header_purpose.md` | 1-308 | عنوان الملف وقواعد التحميل الأولى |
| `01_dependency_resolution.md` | 309-1396 | credential chain، variable contract، async dependencies، Google Workspace dependency resolution |
| `02_live_canonical_api_resolution.md` | 1397-2714 | live canonical resolution، API capability، endpoint resolution، analytics sheet transformation |
| `03_schema_logging_enforcement.md` | 2715-3440 | analytics identity، schema loading، native Google logging preparation |
| `04_wordpress_publish_contract.md` | 3441-3722 | WordPress runtime governance loader bindings |

ملاحظات تنفيذ:

- `01_dependency_resolution.md` و`02_live_canonical_api_resolution.md` هما أكبر قطعتين، لكنهما ما زالا أوضح من الملف الكامل.
- عند بناء `Domain Index` يجب وصف الفرق بين dependency resolution وAPI endpoint resolution بدقة حتى لا يقرأ agent الملف الخطأ.

### 4.4 `prompt_router.md`

العدد المقترح: 6 ملفات مصدر.

| الملف الفرعي | النطاق التقريبي | الغرض |
|---|---:|---|
| `00_header_purpose.md` | 1-337 | عنوان الملف وقواعد routing الأولى |
| `01_core_routing.md` | 338-1458 | HTTP variable-aware routing، async routing، Native Google routing |
| `02_runtime_validation_routing.md` | 1459-2202 | runtime validation declaration، full audit، provider continuity، analytics routing |
| `03_repair_review_routing.md` | 2203-3316 | repair loop guards، forced repair routing، review surface resolution |
| `04_schema_first_routing.md` | 3317-3515 | schema-first routing rule |
| `05_wordpress_publish_contract.md` | 3516-3793 | WordPress publish contract routing patch |

ملاحظات تنفيذ:

- `03_repair_review_routing.md` هو ملف طويل لكنه يمثل منطقة repair/review واحدة واضحة.
- إن ظهرت تعديلات كثيرة لاحقا، يمكن تقسيمه إلى `repair_triggers`, `repair_precedence`, `review_surfaces`.

---

## 5. صيغة `Domain Index`

يضاف في أعلى كل ملف root بعد العنوان مباشرة.

مثال عام:

```md
## Domain Index

This file is generated from `canonicals/system_bootstrap/`.
Edit source files under `canonicals/`; do not edit this root file directly.

| Domain | Source file | Use when |
|---|---|---|
| Logic pointers and knowledge profiles | `canonicals/system_bootstrap/01_logic_pointer_knowledge.md` | Changing canonical pointer authority, knowledge profiles, or brand onboarding |
| Activation transport | `canonicals/system_bootstrap/02_activation_transport.md` | Changing activation, tool-first execution, continuation behavior |
| Runtime validation | `canonicals/system_bootstrap/12_runtime_validation_enforcer.md` | Changing validation lifecycle, pre-write validation, readback, completion lock |
| WordPress publish contract | `canonicals/system_bootstrap/13_wordpress_publish_contract.md` | Changing WordPress publish runtime governance |

---
```

قواعد مهمة:

- يجب أن يكون `Domain Index` قصيرا وعمليا.
- لا يتحول إلى شرح طويل يكرر محتوى الملفات.
- يجب أن يذكر بوضوح أن root file generated.
- يجب أن يستخدم مسارات حقيقية قابلة للفتح.

---

## 6. مواصفات `build-canonicals.mjs`

### الوظيفة

السكريبت يقرأ ملفات `canonicals/<canonical_name>/*.md` بالترتيب الأبجدي، ثم يبني ملف root المقابل.

### المتطلبات

- استخدام Node.js built-ins فقط: `node:fs/promises`, `node:path`.
- الحفاظ على UTF-8.
- منع البناء إذا كان مجلد source غير موجود.
- منع البناء إذا لم يجد أي ملفات `.md`.
- إضافة generated header موحد.
- إضافة Domain Index تلقائيا أو من ملف manifest.
- إنهاء الملف بسطر جديد.

### الشكل المقترح

```js
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const CANONICALS = [
  {
    output: 'system_bootstrap.md',
    sourceDir: 'canonicals/system_bootstrap',
    title: 'system_bootstrap',
    index: [
      ['Logic pointers and knowledge profiles', '01_logic_pointer_knowledge.md', 'Canonical pointer authority, knowledge profiles, brand onboarding'],
      ['Activation transport', '02_activation_transport.md', 'Activation, tool-first behavior, continuation override'],
      ['Runtime validation', '12_runtime_validation_enforcer.md', 'Validation lifecycle, readback, completion lock'],
      ['WordPress publish contract', '13_wordpress_publish_contract.md', 'WordPress publish runtime governance'],
    ],
  },
];

function renderIndex(config) {
  const rows = config.index
    .map(([domain, file, useWhen]) => `| ${domain} | \`${config.sourceDir}/${file}\` | ${useWhen} |`)
    .join('\n');

  return [
    '## Domain Index',
    '',
    `This file is generated from \`${config.sourceDir}/\`.`,
    'Edit source files under `canonicals/`; do not edit this root file directly.',
    '',
    '| Domain | Source file | Use when |',
    '|---|---|---|',
    rows,
    '',
    '---',
    '',
  ].join('\n');
}

async function buildCanonical(config) {
  const sourcePath = path.join(ROOT, config.sourceDir);
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

  if (files.length === 0) {
    throw new Error(`No markdown files found in ${config.sourceDir}`);
  }

  const parts = [];
  for (const file of files) {
    const content = await fs.readFile(path.join(sourcePath, file), 'utf8');
    parts.push(content.trimEnd());
  }

  const output = [
    `# ${config.title}`,
    '',
    '<!-- GENERATED FILE. Edit canonicals sources and run node build-canonicals.mjs. -->',
    '',
    renderIndex(config),
    parts.join('\n\n---\n\n'),
    '',
  ].join('\n');

  await fs.writeFile(path.join(ROOT, config.output), output, 'utf8');
  console.log(`Built ${config.output} from ${files.length} source files`);
}

for (const config of CANONICALS) {
  await buildCanonical(config);
}
```

ملاحظة: الكود أعلاه skeleton. أثناء التنفيذ الفعلي يجب ملء `CANONICALS` للأربعة ملفات كلها.

---

## 7. مراحل التنفيذ

### المرحلة 1: تثبيت baseline

1. تشغيل `git status --short`.
2. التأكد من عدم وجود تعديلات غير مرتبطة سيتم لمسها.
3. قياس الملفات الحالية:

```powershell
Get-Content system_bootstrap.md | Measure-Object -Line
Get-Content direct_instructions_registry_patch.md | Measure-Object -Line
Get-Content module_loader.md | Measure-Object -Line
Get-Content prompt_router.md | Measure-Object -Line
```

المخرج المتوقع: أرقام قريبة من baseline أعلاه.

### المرحلة 2: إنشاء الهيكل

1. إنشاء `canonicals/`.
2. إنشاء مجلد لكل canonical.
3. إنشاء الملفات الفرعية بالأسماء المعتمدة.
4. عدم تعديل ملفات root بعد في هذه المرحلة.

### المرحلة 3: نقل المحتوى

1. قص كل نطاق أسطر إلى الملف الفرعي المناسب.
2. الحفاظ على النص كما هو قدر الإمكان.
3. عدم إعادة صياغة القواعد أثناء التفكيك.
4. إضافة عنوان صغير في أول كل sub-file عند الحاجة فقط.

قاعدة مهمة: هذه المرحلة تفكيك ميكانيكي، وليست refactor لغوي أو منطقي.

### المرحلة 4: بناء السكريبت

1. إضافة `build-canonicals.mjs`.
2. تعريف manifests للأربعة ملفات.
3. إضافة Domain Index لكل ملف.
4. تشغيل:

```powershell
node build-canonicals.mjs
```

### المرحلة 5: المقارنة

بعد البناء، يجب مراجعة الفرق:

```powershell
git diff -- system_bootstrap.md direct_instructions_registry_patch.md module_loader.md prompt_router.md
```

المقبول:

- إضافة generated header.
- إضافة `Domain Index`.
- فواصل `---` بين الملفات الفرعية.
- تغييرات طفيفة في blank lines نتيجة `trimEnd`.

غير المقبول:

- اختفاء قواعد.
- تبدل ترتيب قواعد.
- تغير نصوص authority أو MUST/SHOULD.
- كسر code fences.
- نقل WordPress patch إلى نطاق خاطئ.

### المرحلة 6: التحقق الآلي

يضاف تحقق بسيط داخل `build-canonicals.mjs` أو سكريبت مستقل لاحقا:

- التأكد من أن كل output يحتوي على `## Domain Index`.
- التأكد من أن كل output يحتوي على generated marker.
- التأكد من عدم وجود ملفات source فارغة.
- التأكد من أن أسماء source files تبدأ برقم ترتيبي.
- التأكد من عدم وجود duplicate filenames في manifest.

### المرحلة 7: التوثيق

تحديث `README.md` أو إضافة قسم قصير:

```md
## Canonical Editing Workflow

Edit files under `canonicals/`.
Then run:

node build-canonicals.mjs

Do not edit generated canonical root files directly.
```

---

## 8. نقاط التحقق قبل الاعتماد

- [ ] `canonicals/` يحتوي 35 ملف مصدر تقريبا.
- [ ] كل ملف root يعاد بناؤه بنجاح.
- [ ] كل ملف root يحتوي `Domain Index`.
- [ ] كل Domain Index يشير إلى ملفات موجودة فعلا.
- [ ] `node build-canonicals.mjs` يعمل مرتين دون diff جديد في المرة الثانية.
- [ ] لا توجد code fences مكسورة.
- [ ] لا توجد عناوين WordPress mojibake أو encoding broken.
- [ ] `git diff` مفهوم ومحدود إلى التفكيك والبناء.
- [ ] تم توثيق أن التعديل يكون داخل `canonicals/`.

---

## 9. المخاطر وحلولها

| الخطر | الأثر | الحل |
|---|---|---|
| كسر ترتيب القواعد | قد يتغير precedence | استخدام أسماء رقمية `00_`, `01_`, ومراجعة diff |
| فقدان نص أثناء القص | كسر governance | مقارنة الحجم والأسطر والبحث عن عناوين رئيسية |
| كسر code fences | markdown غير صالح | فحص عدد ``` قبل وبعد |
| Domain Index مضلل | agent يقرأ ملفا خطأ | كتابة use-when واضح ومختصر |
| تعديل root يدويا بعد التفكيك | ضياع التعديل عند build | generated marker وتوثيق workflow |

---

## 10. سياسة Rollback

إذا فشل التفكيك:

1. لا يتم حذف ملفات root الأصلية من Git.
2. يمكن حذف أو تجاهل `canonicals/` و`build-canonicals.mjs`.
3. الرجوع يكون بإلغاء التعديلات الخاصة بالتفكيك فقط.
4. لا تستخدم rollback شامل إذا كانت هناك تعديلات أخرى غير مرتبطة في working tree.

خطة rollback اليدوية الآمنة:

```text
راجع git diff.
حدد الملفات التي أضيفت للتفكيك فقط.
أزلها أو اتركها غير staged.
أبق ملفات root الأصلية كما كانت إن لم يتم اعتماد build output.
```

---

## 11. ترتيب التنفيذ الموصى به

1. تنفيذ `module_loader.md` أولا لأنه الأقل عددا في الملفات الفرعية.
2. تنفيذ `prompt_router.md` ثانيا لأن repair/review block واضح.
3. تنفيذ `system_bootstrap.md` ثالثا لأنه الأكبر.
4. تنفيذ `direct_instructions_registry_patch.md` أخيرا لأنه الأكثر حساسية وفيه تداخل نطاقات.

سبب هذا الترتيب:

- يبدأ التنفيذ بملفات ذات boundaries أوضح.
- يقل خطر كسر direct instruction authority مبكرا.
- يتم اختبار build script على حالات أبسط قبل الملف الأكثر حساسية.

---

## 12. قرار التنفيذ

التنفيذ مناسب الآن بشرط الالتزام بهذه القيود:

- التفكيك يكون ميكانيكيا في المرحلة الأولى.
- لا يتم تعديل معنى أي قاعدة أثناء النقل.
- لا يتم حذف أي canonical root file.
- يتم تشغيل build والتحقق من idempotency.
- يتم ترك direct instructions المتداخلة للمراجعة اليدوية الدقيقة عند القص.

الحالة النهائية المطلوبة:

```text
35 source files تقريبا داخل canonicals/
4 generated root files مع Domain Index
build-canonicals.mjs قابل للتشغيل
workflow موثق وواضح
```
