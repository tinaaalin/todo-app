# Module Detail: Configuration Management

## Core Features

1. Manages several hundred report configurations (the nested report/file/table configuration structure), replacing the v1 approach of storing them in a text field of a Sybase table.
2. Supports schema validation, version history, and audit traceability for configurations.
3. (Future direction) Integrates with the company's internal approval workflow system, ensuring that configuration changes only take effect after approval.

## Tech Stack

1. MongoDB: the primary store for report business configuration.
2. MongoDB's native JSON Schema validation: constrains required fields and types in the report/file/table structure.
3. (Future direction, dependent on adopting Nacos) Nacos Config + PostgreSQL: management and persistence of environment-level/infrastructure-level configuration.

## Report Configuration Storage: MongoDB

1. Migration driver: v1 stores serialized report JSON in the text field of a Sybase table; since Sybase is losing vendor support, migrating this data store is a hard requirement within v2's scope.
2. Rationale for the choice: MongoDB is already used in production by other projects at the company, so choosing it represents tech-stack consolidation rather than introducing new infrastructure, and its operational, monitoring, and backup experience can be reused directly. PostgreSQL (JSONB) was also evaluated as a candidate and considered viable — given the team's stronger relational-database background and clearer licensing compliance — but MongoDB was ultimately chosen based on tech-stack consolidation considerations.
3. Recommend enabling MongoDB's native JSON Schema validation to constrain required fields and types across the report/file/table structure, mitigating the "configuration decay" problem (i.e., the risk that over time no one can say for certain which service a given report still relies on).
4. Recommend adding a version field and establishing a separate history collection to store change history, for audit and rollback purposes.
5. Recommend validating, at config-publish time or at system startup, that the serviceName/operator references in a configuration exist in the currently registered whitelist — a fail-fast check that avoids errors surfacing only at runtime due to a broken reflective call (one of v1's core pain points).

## Approval-Workflow Integration: The v1 State and the v2 Plan (Dependent on Nacos)

1. v1 situation: file-based configuration, integrated with the company's internal approval workflow system, requiring configuration changes to go through approval before taking effect.
2. Precondition for the envisioned v2 plan: Nacos would first need to be introduced to handle environment-level configuration management (see the future-direction evaluation of Nacos in [service-discovery.md](service-discovery.md)); this plan is not a near-term requirement.
3. Envisioned approach: the approval system acts as a front gateway to Nacos — no one is permitted to operate the Nacos console/API directly; all changes must be approved through the approval system first, after which a purpose-built lightweight config-publishing gateway service calls the Nacos Open API to perform the actual publish.
4. Accompanying access-tightening design: Nacos RBAC permissions are granted only to the publishing gateway's service account, with business users/developers restricted to read-only access — mechanically preventing anyone from bypassing approval to publish directly.
5. Accompanying audit design: the approval ticket number is attached as metadata (a Tag or description field) and linked to the Nacos publish record, closing the gap left by Nacos's own his_config_info, which only records post-publish changes and does not include pre-approval records.
6. Gray-release coordination: Nacos's Beta/Tag gray-release capability can be used to support tiered approval needs in the workflow (e.g., a first-level approval triggers a gray rollout, and a second-level approval — after confirming no issues — triggers full rollout).
7. Fault-tolerance design (not yet detailed): if an approval callback fails or the gateway service goes down, leaving a change stuck in an "approved but not published" state, an idempotent retry mechanism and a manual operator publish-completion entry point (with permission auditing) are needed.

## Open Points

1. Absent a near-term move to Nacos, how the v1 approval workflow system connects with the new v2 configuration-management approach has not yet been designed — since report configuration itself lives in MongoDB, whether approval integration is still needed, and how it would work, remains an open question.
2. The specific schema design for MongoDB report configuration (which fields require strict validation, the specific JSON Schema rules) has not yet been finalized — only directional recommendations exist so far.

See the main document: [../genie-v2-architecture-notes-en.md](../genie-v2-architecture-notes-en.md).
