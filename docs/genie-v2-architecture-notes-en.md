# Genie Reporting System v1 → v2 Microservices Refactor — Discussion Notes

This document is the overview and index. Detailed design for each module has been split out into standalone files under the `modules-en/` directory; the body below lists core features and tech stack briefly per module, with links to the corresponding detail files.

## I. Background and Review of v1

1. v1 architecture: a report contains multiple files, and each file contains multiple tables; report/file/table each have a rich set of optional configurations (format, data source, threshold-based highlighting rules, downstream FTP/email distribution, etc.), backed by a set of POJOs and Handlers.
2. The entire configuration is serialized as JSON, stored in a text field of a Sybase table; the system as a whole manages several hundred such JSON documents.
3. Table data is fetched by the service layer calling the DAO layer (raw SQL), with business processing (filter/aggregate, etc.) done inline via Java Streams within the service layer; the service name is written into the JSON and invoked via reflection.
4. Migration driver: Sybase is losing vendor support, so migrating this database is a hard requirement within v2's scope, not merely an architectural optimization choice.

### v1 Strengths

1. Common flows (rendering, highlighting, distribution) are decoupled from business logic — adding a new report usually only requires new config plus a service implementation.
2. High reuse across formatting conversion, threshold highlighting, and distribution capabilities.
3. Configuration is declarative and, in principle, auditable.

### v1 Weaknesses

1. Reflective invocation loses type safety — the IDE cannot trace references, and a deleted or renamed service is not caught at compile time, only surfacing as a runtime failure.
2. The service layer is overloaded: raw SQL and business processing (filter/map, etc.) are tightly coupled, making unit testing and reuse difficult.
3. The JSON configuration is effectively a hidden DSL, lacking schema validation and a version-evolution mechanism — with hundreds of configurations, this carries a long-term risk of "configuration decay."
4. Reflective invocation causes exception stacks and monitoring instrumentation to take detours, making unified tracing by report/service dimension difficult.
5. Within the monolithic application, an exception or slow query in one service can drag down other report tasks.

## II. Module Overview: Core Features and Tech Stack

### 1. Report Engine

1. Core features: manages report configuration, orchestrates the entire report-generation flow, maintains the lifecycle state machine, organizes internal processing steps via the Chain of Responsibility pattern, and handles cron-platform trigger requests through an idempotent asynchronous acceptance mechanism.
2. Tech stack: Java + Spring Boot, MongoDB Driver, Kafka Producer/Consumer, gRPC Client + Arrow IPC, lightweight OpenFeign.
3. The trigger entry point `/go-report` changes from "return only after synchronous completion" to "return a 202 upon acceptance," with the actual data-fetching/processing/distribution running asynchronously, paired with an idempotency key (report_id + COB date) to prevent duplicate execution from cron-platform retries, and with support for stage-level status queries/retries/cancellation.
4. See [modules-en/report-engine.md](modules-en/report-engine.md) (includes the full lifecycle sequence diagram).

### 2. Data API Server

1. Core features: uniformly ingests various source data, exposes a REST API, and lands query results to shared storage while returning a reference.
2. Tech stack: Java + Spring Boot, JDBC drivers for each business data source, a Parquet-writing library, S3/MinIO SDK.
3. See [modules-en/data-api-server.md](modules-en/data-api-server.md).

### 3. Data Processor

1. Core features: a general-purpose vectorized data processor that executes filter/merge/assign/aggregate operations via a whitelisted, parameterized operator DSL, replacing hardcoded Java Streams.
2. Tech stack: Python, pandas/numpy, pyarrow, gRPC Server, Kafka Consumer/Producer.
3. The only service that must be deployed independently for a technology-stack reason (vectorized computation capability).
4. See [modules-en/data-processor.md](modules-en/data-processor.md).

### 4. Monitor

1. Core features: listens for alert signals (subscribing to the unified Kafka event stream) and notifies users through multiple channels.
2. Tech stack: Java + Spring Boot (if deployed independently), Kafka Consumer, notification-channel SDKs.
3. Whether it needs to be split into an independent microservice is still being evaluated — unlike the Data Processor, there is currently no clear rationale for independent deployment.
4. See [modules-en/monitor.md](modules-en/monitor.md).

### 5. Infrastructure: Messaging and Shared Storage

1. Core features: handles cross-service task dispatch/status-event notification (Kafka), raw-data transfer (NFS near-term, S3/MinIO + Parquet in the future), and efficient transfer of processed results (gRPC + Arrow IPC).
2. Tech stack (near term): Kafka, NFS (mounted path + standard file I/O), Apache Parquet, gRPC, Apache Arrow, mTLS.
3. Tech stack (future, trigger conditions in the detail file): S3/MinIO replacing NFS, providing native TTL, fine-grained IAM, atomic writes, and elastic throughput.
4. The storage-access layer is recommended to be built as a replaceable abstraction interface, to enable a smooth future migration from NFS to S3 without touching business logic.
5. See [modules-en/infra-messaging-storage.md](modules-en/infra-messaging-storage.md).

### 6. Configuration Management

1. Core features: manages several hundred report configurations (schema validation, version history, audit traceability), replacing the Sybase text-field approach.
2. Tech stack: MongoDB + JSON Schema validation; future direction (dependent on Nacos): Nacos Config + PostgreSQL.
3. See [modules-en/config-management.md](modules-en/config-management.md).

### 7. Inter-Service Calling and Service Discovery

1. Core features (near term): DNS-based service discovery + lightweight Feign declarative calls.
2. Tech stack (near term): DNS (K8s CoreDNS), `spring-cloud-starter-openfeign` (lightweight), K8s Service network-layer load balancing.
3. Future direction: Nacos (service discovery + configuration management) — trigger conditions and cost of introduction are in the detail file.
4. See [modules-en/service-discovery.md](modules-en/service-discovery.md).

## III. Migration Strategy

1. Adopts the Strangler Fig pattern for gradual replacement rather than a one-time rewrite; the downstream distribution system has already been split out and validated as the starting point.

## IV. Principle of Infrastructure Reuse and Consolidation

1. Core principle: microservice decomposition should prioritize reusing the company's existing infrastructure, introducing new components only where an architectural paradigm shift (e.g., monolith-to-microservices) genuinely requires it.
2. Kafka and MongoDB have been confirmed as reuse of existing clusters, incurring no new operational cost.
3. If PostgreSQL, S3/MinIO, etc. need to be introduced, priority should go to requesting a new schema or bucket on the company's existing instance/platform, rather than standing up new hardware/a new cluster independently; adopting the company's readily available NFS as the near-term shared storage is a typical application of this principle.
4. After evaluation, Redis and Nacos will not be introduced near-term and are retained as future directions for evaluation — see [modules-en/data-processor.md](modules-en/data-processor.md) (Redis) and [modules-en/service-discovery.md](modules-en/service-discovery.md) (Nacos).
5. Microservice-splitting granularity should remain conservative: the Data Processor is the only service with a clear, irreplaceable rationale for independence; whether other modules need to become independent microservices should be determined based on the team's operational capacity and actual scaling needs.
6. At a team size of five, microservices fundamentally trade operational complexity for code decoupling — whether this trade is worthwhile needs ongoing evaluation, and architectural decisions should serve the team's actual carrying capacity rather than the sophistication of the technology choice itself.

## V. Open Questions

1. The specific version-evolution mechanism for the Data Processor's operator DSL has not been detailed — how version numbers route to different processing logic, and how coexistence of old and new versions should be managed.
2. Absent a near-term move to Nacos, how the v1 approval workflow system connects with the new v2 configuration-management approach has not yet been designed.
3. The specific schema design for MongoDB report configuration (which fields require strict validation, the specific JSON Schema rules) has not yet been finalized — only directional recommendations exist so far.
4. The version-management process for gRPC/Arrow protobuf definitions across the Java-Python boundary (.proto synchronization, CI integration) has not been detailed, and it remains to be assessed whether the team's gRPC experience is sufficient, or whether to validate the flow with REST+gzip first before switching over.
5. The specific implementation details of TTL cleanup scripts for Parquet intermediate data on NFS (near term), and the native lifecycle rules and access isolation (bucket/prefix by report type) after a future migration to S3/MinIO, have not been finalized.
6. The long-term archival pipeline for final report results (as distinct from short-term cleanup of intermediate raw data) has not been designed.
7. It needs to be confirmed whether the company already has a reusable unified object-storage platform and PostgreSQL instance, to determine whether S3/MinIO and PostgreSQL would truly be newly introduced infrastructure in the future.
8. schema_version (for raw-data schema) and the operator DSL version number are currently two independent versioning mechanisms; if the two evolve out of sync, it has not yet been decided at which point in the pipeline compatibility checks should occur.
9. Whether the Monitor service needs to become an independent microservice, or should run as a module inside the Report Engine for now, requires further evaluation in light of the team's operational capacity.
10. In the near-term approach, the Data Processor's completion event carries its own instance address so the Engine can pull directly; if that instance restarts or is scaled down before the pull completes, the pull will still fail and trigger recomputation. The acceptable level of this risk needs to be assessed against the actual lifecycle stability of Data Processor instances, and it remains to be seen whether Redis-based result referencing needs to be introduced earlier than planned.
11. It needs to be confirmed whether the company's cron job platform supports asynchronous task modes (status polling, webhook callbacks) — this determines how visibility into "the report has truly completed" is surfaced to existing operational monitoring habits, and needs to be aligned with the platform's maintainers/business stakeholders in advance.
12. The specific permission controls for the "retry from a specific stage" endpoint (`POST /go-report/{task_id}/retry?fromStage=xxx`) — who can trigger a retry, and which stages may be retried individually — have not yet been designed.
