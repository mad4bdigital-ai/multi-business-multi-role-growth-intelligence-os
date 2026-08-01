# Synthetic adapter provenance brand

Workstream: `synthetic-executor`

Base integration SHA: `9e40df9942731c5fbe81006796c9a4bb73e33d2d`

The canonical in-memory synthetic adapter factory now owns an unforgeable process-local `WeakSet` brand. `isCanonicalHostingerStorageSyntheticAdapter` returns true only for frozen adapters created by that exact factory instance and retaining the expected key, version, and non-production safety flags.

A caller-created frozen object that copies every public field and method remains unbranded and is rejected. The original adapter behavior is preserved byte-for-byte in an internal Base module, and CI forbids direct imports of that Base module outside the governing factory wrapper.

Safety boundary remains synthetic-only and non-production. No live provider, filesystem, shell, SSH, network, credential, route, SQL, migration, deployment, `main`, or `Production` authority is introduced.
