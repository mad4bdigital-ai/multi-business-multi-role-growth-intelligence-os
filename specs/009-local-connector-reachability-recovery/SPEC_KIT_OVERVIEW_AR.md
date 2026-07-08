# نظرة تنفيذية: استرداد اتصال Local Connector

## المشكلة

ظهر عندنا gap واضح: إعداد الجهاز موجود ومربوط بالمستخدم والـ tenant، لكن لا يوجد route runtime مسجل، ومسار `auth.mad4b.com` ومسار `connector.mad4b.com` رجعوا 502. هذا يعني أن النظام كان يملك config لكنه لا يملك readback موثوق يثبت أن الجهاز reachable أو أن tunnel/host يعمل.

## القرار التصميمي

لن نتعامل مع الاتصال كـ URL واحد. سنفصل lifecycle إلى مسارين مستقلين:

1. **Tenant auth-host path** عبر `auth.mad4b.com`: للاستخدام اليومي، اختيار الجهاز، auto-install، actions المحكومة، وواجهات المستخدم.
2. **Admin break-glass path** عبر `connector.mad4b.com`: للتشخيص والاسترداد الإداري فقط عندما يفشل المسار العادي.

كل مسار له حالة صحية مستقلة، سبب فشل مستقل، وسياسة استرداد مستقلة. لا يجوز تصعيد tenant path إلى break-glass path تلقائيًا.

## لماذا DB + profile-aware

بعد PR #2357 أصبح lifecycle profile ديناميكيًا من DB حسب `global / tenant / user / device`. هذه spec تكمل ذلك بحيث يصبح اختيار الجهاز والمسار مبنيًا على profile المستخدم والجهاز، وليس hostname أو alias عشوائي.

## السيناريوهات التي يغطيها التصميم

- فورمات الجهاز.
- تغيير نسخة Windows أو Windows install instance.
- استبدال الجهاز بالكامل.
- وجود أكثر من جهاز لنفس المستخدم.
- اختيار الجهاز المستهدف صراحة من auth-host.
- إعادة تثبيت connector تلقائيًا عند فقدان route.
- عزل فشل Cloudflare tunnel عن فشل local service.
- استخدام break-glass للتشخيص فقط وليس كمسار tenant action.

## المخرجات المطلوبة في التنفيذ اللاحق

- Route registry يسجل كل channel وحالته.
- Heartbeat من الجهاز إلى auth-host.
- Probe منفصل لـ tenant path وbreak-glass path وtunnel endpoint وlocal service.
- Target selector يعتمد على `tenant_id + user_id + canonical_device_id`.
- Recovery planner يوصي بـ relink / reinstall / token rotation / route revoke.
- Auto-install يستخدم profile المستخدم والجهاز ويطلب fresh authorization عند الحاجة.

## حدود Draft PR

هذا Draft PR تصميم فقط. لا يشغل tunnel، لا يغير DNS، لا يثبت connector، ولا يقرأ أسرار. التنفيذ سيأتي عبر PRs صغيرة محكومة بعد المراجعة.
