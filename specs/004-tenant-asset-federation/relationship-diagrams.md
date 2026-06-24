# Relationship Diagrams

## 0. Business-Type Blueprint inheritance

```mermaid
flowchart TD
    BT[Business Type]
    BP[Versioned Layer Blueprints]
    BIND[Brand Business-Type Bindings]
    PROF[Brand Inheritance Profile]
    PREVIEW[Inheritance Preview and Conflict Resolution]
    INST[Brand-scoped Layer Instances]
    DEPT[Departments / Sub-departments]
    GROUP[Groups]
    PRINC[Human / AI Agent / Service Principals]
    ROLE[Roles and Delegations]
    KNOW[Knowledge and Memory Trees]
    ASSET[Canonical Shared Asset References]
    MAN[Effective Runtime Manifest]

    BT --> BP
    BP --> BIND
    BIND --> PROF
    PROF --> PREVIEW
    PREVIEW --> INST
    INST --> DEPT
    DEPT --> GROUP
    GROUP --> PRINC
    INST --> ROLE
    INST --> KNOW
    INST --> ASSET
    DEPT --> MAN
    GROUP --> MAN
    PRINC --> MAN
    ROLE --> MAN
    KNOW --> MAN
    ASSET --> MAN
```

```text
Tenant
└─ Brand
   ├─ inherited/local Business Activities
   ├─ Departments
   │  ├─ Sub-departments
   │  └─ Groups
   │     ├─ Human members
   │     ├─ AI Agent assignments/profiles
   │     └─ Service principals
   ├─ Roles and delegations
   ├─ Knowledge and memory trees
   └─ bindings to shared Skills, Workflows, Policies, Apps, Tools, Graphs, Engines, Logic, and future registered assets
```

Business Types provide reusable templates. Brands own the live organizational instances. Shared resources are referenced rather than copied.

### Generic layer graph

```mermaid
erDiagram
    LAYER_TYPE ||--o{ BLUEPRINT : defines
    BUSINESS_TYPE ||--o{ BLUEPRINT : owns
    BLUEPRINT ||--o{ BLUEPRINT_RELATIONSHIP : source
    BLUEPRINT ||--o{ BLUEPRINT_RELATIONSHIP : target
    BLUEPRINT ||--o{ BLUEPRINT_RESOURCE_BINDING : references
    BRAND ||--o{ BUSINESS_TYPE_BINDING : selects
    BRAND ||--o{ INHERITANCE_PROFILE : configures
    INHERITANCE_PROFILE ||--o{ INHERITANCE_RULE : contains
    BLUEPRINT ||--o{ BRAND_LAYER_INSTANCE : instantiates
    BRAND_LAYER_INSTANCE ||--o{ BRAND_LAYER_RELATIONSHIP : source
    BRAND_LAYER_INSTANCE ||--o{ BRAND_LAYER_RELATIONSHIP : target
    BRAND_LAYER_INSTANCE ||--o{ BRAND_LAYER_RESOURCE_BINDING : resolves
    BRAND_LAYER_INSTANCE ||--o{ LAYER_OVERRIDE_PATCH : customizes
```

### Multiple Business Types

```mermaid
flowchart LR
    BT1[Primary Business Type]
    BT2[Secondary Business Type]
    BT3[Specialization]
    ALG[Per-layer inheritance algebra]
    EQ[Equivalence / supersession / conflict]
    BRAND[Effective Brand layer graph]

    BT1 --> ALG
    BT2 --> ALG
    BT3 --> ALG
    ALG --> EQ
    EQ --> BRAND
```

Recommended behavior differs by layer family: organization/knowledge/workflows use guarded union with equivalence checks, execution authority uses intersection and deny-wins, quotas use minimum, and risk/approval use maximum.

## 1. Shared assets and optional variants

```mermaid
erDiagram
    SHARED_ASSET ||--o{ RESOURCE_BINDING : referenced_by
    SHARED_ASSET ||--o{ OPTIONAL_VARIANT : customized_as
    OPTIONAL_VARIANT ||--o{ VARIANT_PATCH : contains
    PRINCIPAL_SCOPE ||--o{ OPTIONAL_VARIANT : owns
    CONTEXT_CONTAINER ||--o{ RESOURCE_BINDING : declares
    COMPOSITION_PROFILE ||--o{ COMPOSITION_RULE : configures
    PRINCIPAL_SCOPE ||--o{ COMPOSITION_PROFILE : selects

    SHARED_ASSET {
      string asset_ref PK
      string asset_type
      string canonical_table
      string canonical_key
      string base_version
      string risk_class
    }
    OPTIONAL_VARIANT {
      string variant_id PK
      string tenant_id
      string base_asset_ref FK
      string owner_scope_type
      string owner_scope_ref
      string status
    }
    VARIANT_PATCH {
      string patch_id PK
      string variant_id FK
      string patch_type
      json patch_json
      string risk_class
    }
```

A shared asset is directly usable when authority and readiness permit. A variant is optional and never required for ordinary use.

## 2. Context graph

```mermaid
graph TD
    P[Platform safety floor] --> T[Tenant]
    T --> W[Workspace]
    W --> B[Brand]
    W --> A[Business Activity]
    B --> A
    W --> F[Workflow context]
    B --> F
    A --> F

    R[Role assignment] -. principal-specific .-> W
    R -.-> B
    R -.-> A
    U[User preference profile] -. narrows/ranks only .-> F
```

Brand, activity, and workflow may have multiple parents. All paths are evaluated within bounded limits.

## 3. Effective runtime resolution

```mermaid
flowchart LR
    I[Signed principal + intent] --> C[Resolve tenant/workspace/brand/activity/role]
    C --> G[Dynamic Container paths and authority]
    G --> K[Shared asset candidates]
    K --> M[Select composition profiles]
    M --> A[Typed policy algebra]
    A --> V[Apply eligible optional variants]
    V --> P[Apply user preferences]
    P --> R[Connection, credential, grant, quota, approval, certification]
    R --> E[Immutable effective runtime manifest]
    E --> X[Dispatch or typed block]
```

Authority is resolved before preference and before credentials are materialized.

## 4. Policy layers

```mermaid
flowchart TD
    L0[Mandatory platform rules] --> ALG[Typed policy algebra]
    L1[Tenant policy] --> ALG
    L2[Workspace policy] --> ALG
    L3[Brand policy] --> ALG
    L4[Activity policy] --> ALG
    L5[Role policy] --> ALG
    L6[User non-authority preferences] --> ALG
    L7[Session/task bounded selectors] --> ALG
    ALG --> O[Effective policy + explanation]
```

Mandatory rules are not a user-selectable layer and cannot be removed.

## 5. Credential relationships

```mermaid
erDiagram
    TENANT ||--o{ CONNECTION : owns
    USER ||--o{ CONNECTION : may_own
    CONNECTION ||--o{ INSTALLATION : validates_as
    SHARED_ASSET ||--o{ ACTION_BINDING : exposes
    OPTIONAL_VARIANT ||--o{ ACTION_BINDING : may_adjust_non_secret_config
    CONTEXT_CONTAINER ||--o{ RESOURCE_BINDING : authorizes
    CONNECTION ||--o{ RESOURCE_BINDING : eligible_reference
    INSTALLATION ||--o{ CERTIFICATION : proves

    ACTION_BINDING }o--|| CONNECTION : resolves_at_runtime
```

No credential value is stored in a shared asset, variant, profile, or policy composition row.

## 6. Adaptive growth loop

```mermaid
flowchart LR
    S[Signals and outcomes] --> D[Diagnosis and attribution]
    D --> Q[Adaptive change proposal]
    Q --> SIM[Replay/simulation]
    SIM --> GATE[Risk and approval gate]
    GATE --> CANARY[User/context canary]
    CANARY --> MEASURE[Outcome measurement]
    MEASURE -->|positive and stable| PROMOTE[Promote profile/variant or platform candidate]
    MEASURE -->|negative or uncertain| ROLLBACK[Rollback/expire]
    PROMOTE --> S
    ROLLBACK --> S
```

## 7. Existing-to-target bridge

```mermaid
graph LR
    EP[execution_policies] --> B1[Policy bridge]
    PR[platform_engine_policy_registry/rules] --> B1
    ASG[agent_skill_grants] --> B2[Grant bridge]
    AWB[agent_workflow_bindings] --> B2
    AAG[app_action_grants] --> B2
    WRG[workspace_resource_grants] --> B2
    B1 --> DCA[Dynamic Container Authority]
    B2 --> DCA
    DCA --> SHADOW[Shadow comparison]
    SHADOW --> CUTOVER[Family-by-family certified cutover]
```

No bridge becomes enforcement authority solely because the schema exists.
