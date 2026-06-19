# ملخص عربي — حزمة معالجة أمن الصلاحيات والتنفيذ

## الهدف

توحيد قرار الأمن والتنفيذ حول هوية واحدة للعملية، بدل أن تختلف الصلاحيات حسب كون الطلب جاء عبر `action_key` أو `tool_key`.

## أخطر المشكلات التي تعالجها الحزمة

1. تصعيد الصلاحيات بتغيير نوع الـselector.
2. وصول tenant إلى أدوات أو surfaces إدارية.
3. قبول أكثر من selector مع اختيار صامت.
4. اعتبار الأداة الصريحة `no_action_requested`.
5. الخلط بين عدم الحاجة إلى credential وبين السماح بالتنفيذ.
6. وصول مسار credential intake الإداري إلى tenant resolver.
7. الاعتماد على skill فقط دون إثبات device ownership أو local consent.
8. اعتبار الجهاز المسجل healthy دون live verification.
9. وصول عمليات state-changing إلى readiness دون approval واضح.
10. غياب trace يوضح ما تم تقييمه وما لم يتم تقييمه.

## مبدأ الحل

كل طلب يمر بالترتيب التالي:

```text
هوية المستخدم والـtenant
→ التحقق من selector واحد
→ التحويل إلى canonical capability
→ صلاحية الـsurface
→ ملكية الـresource
→ skill
→ credential requirement/usability
→ device trust
→ smoke
→ approval
→ local consent
→ dispatch readiness
```

أي gate مطلوبة لا تنجح تعني رفض التنفيذ. وأي policy ناقصة تعني رفضًا افتراضيًا.

## الأولويات

### احتواء فوري P0

- منع tenant من كل admin tool غير مربوط صراحة بمسار tenant-safe.
- رفض `action_key` و`tool_key` معًا.
- تعطيل أي tool alias يتجاوز سياسة action أشد.
- منع credentials غير validated من التنفيذ.
- منع raw admin credential intake.
- تعطيل mutations عالية الخطورة حتى اكتمال policy.

### البناء الأساسي

- canonical capability registry
- unified policy engine
- structured gate results
- secure intake wrapper
- device trust evaluator
- approval binding and replay prevention
- truthful readiness statuses
- immutable decision trace

## شرط الإغلاق

لا تُغلق الثغرات بمجرد أن الاختبار توقف عند `skill_not_granted`. يجب أن تثبت الاختبارات المستقلة أن:

- tenant/admin isolation يعمل
- device ownership يعمل
- local consent يعمل
- credential scope يعمل
- selector parity كاملة
- لا توجد required gate بحالة `not_evaluated` في قرار مسموح
- لا يوجد `dispatch_ready` قبل نجاح كل البوابات
