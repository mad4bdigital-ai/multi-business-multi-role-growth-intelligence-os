# Governed Production synchronization request

Purpose: prepare the repository-canonical exact-main-tree Production candidate for the current validated main state after PR #6528 and subsequent main advancement through PR #6546.

Pinned at request creation:
- main: 398aed2b60f51ac7f1062e733fb4833918a5a735
- Production: 1c8ef0263070a9e98c2bcefbc360828b8c4fd687

Scope note: the canonical promotion contract requires an exact current-main tree. Therefore any candidate prepared from this request necessarily includes all commits currently in main, including PR #6528 and PR #6546; this request does not authorize isolating or rewriting either change.

This request surface is temporary and must not be merged. It authorizes candidate/validation preparation only and authorizes no Production merge, deployment, Hostinger/provider action, SQL, migration Apply, database mutation, credential read, secret access, protected-ref bypass, force push, restart, or external send.