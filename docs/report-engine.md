# Module Detail: Report Engine

## Core Features

1. Manages report configurations (stored in MongoDB); provides reading, validation, and publishing of configs.
2. Orchestrates the entire report generation flow: dispatches data-fetch requests to the Data API, dispatches data-processing tasks to the Data Processor, handles returned results, and triggers Monitor notifications or downstream distribution.
3. Maintains the report lifecycle state machine, supporting failure retries and resumable execution, with idempotency guaranteed.
4. Internal processing steps (config validation, request assembly, task assembly, result handling, downstream triggering) are organized using the Chain of Responsibility pattern, allowing new steps to be plugged in flexibly.
5. Performs fail-fast validation of serviceName/operator references in configs, catching invalid references at config publish time or service startup.

## Tech Stack

1. Java + Spring Boot as the base service framework.
2. MongoDB Java Driver, for reading/writing report configs and their version history.
3. Kafka Producer/Consumer, for sending and receiving task-dispatch signals and status events.
4. gRPC Client (paired with Arrow IPC decoding), for pulling processed results from the Data Processor.
5. OpenFeign (lightweight, without the LoadBalancer/service-discovery starters), for declarative HTTP calls to services such as the Data API Server, targeting fixed Service names resolved via DNS.
6. Chain of Responsibility pattern (in-house lightweight framework, not a third-party library) + state machine (in-house implementation using an enum + a state-transition table + an optimistic-lock version field; Spring StateMachine was not adopted).

## Internal Design: Chain of Responsibility + State Machine, Layered

1. The state machine manages the cross-service, potentially asynchronous report lifecycle: REQUESTED → DATA_FETCHING → PROCESSING → READY → DELIVERED → FAILED.
2. State changes must be persisted and must simultaneously emit a Kafka event for Monitor and other downstream consumers to subscribe to.
3. "Failed to fetch result" should be modeled as a legitimate state transition in the state machine (e.g., falling back to re-triggering processing), not as an unhandled exception.
4. Kafka provides at-least-once semantics, so task-status lookups plus an optimistic-lock version field are needed to prevent the same completion message from being consumed twice and triggering duplicate downstream actions (e.g., sending the same email twice).
5. The Chain of Responsibility pattern is used to organize the synchronous sub-steps the Engine executes locally within a given state — for example, config parsing and result validation within the PROCESSING state. Adding a new step only requires inserting a new Handler, without touching existing code.
6. The Chain of Responsibility pattern itself does not solve cross-service asynchronous waiting or resuming after a failed retry — both still depend on the state machine's persisted state and idempotency design.

## Suggested Code Structure (genie-report module)

1. Current issues: handler/model packages are duplicated across multiple levels (one set at the core root, one under file, one under report); the organizing principle is inconsistent (mixing the entity dimension with the technical-layer dimension); DefaultHandlerChainConfig / Task sit bare at the core root with no home package.
2. Suggested reorganization: `core/chain` (Chain of Responsibility framework) + `core/model` (models shared across stages) + `core/stage/{upstream, checkrule, table, file, report, downstream}` (organized by processing stage, each with its own handler/model subpackages).
3. rpc/signal/retry/thread/dao and other infrastructure concerns should move into a separate `infra/` package, decoupled from the `core` business chain.
4. The `signal` package should be renamed to something more explicit like `messaging`/`kafka`, since "signal" is too generic.

## Trigger Mechanism: Review of the v1 Approach

1. In v1, several hundred scheduled jobs were configured and managed through the company's unified cron job platform; each job's content was a curl HTTP request sent to the `/go-report` endpoint.
2. On the backend, the request was handled by a Spring Boot NIO thread, which cloned a report JSON/POJO and ran it sequentially through each stage's Handler — querying data, applying custom processing, and distributing per configuration — all completed in-memory in one continuous pass, ultimately returning HTTP 200 with details in the response body.
3. Problems with this approach:
   1. Long-connection timeout risk — processing time is unpredictable, and timeout settings on the cron platform or intermediate network layers may cut the connection before backend processing finishes, causing recorded status and actual outcome to diverge.
   2. No idempotency design — a cron-platform retry simply re-invokes the entire `/go-report` call; if the previous invocation had actually completed, this causes duplicate distribution (duplicate emails, duplicate uploads to downstream systems).
   3. Concurrency capacity is tightly coupled to the HTTP thread pool — when hundreds of jobs fire together during a batch window, there is no buffering layer; capacity is entirely bounded by how much instantaneous concurrency the JVM thread pool can absorb.
   4. A process crash means the task is lost entirely — the whole process runs in memory with no persisted intermediate state, so there is no way to know which step a task had reached.
   5. No state-management mechanism, so there is no way to intervene, cancel, or retry at a specific stage.

## Trigger Mechanism: v2 Design

1. Core idea: fully decouple "trigger acknowledgment" from "actual execution." `/go-report` changes from "returns only after processing completes" to "returns as soon as the task is accepted." The actual data-fetching/processing/distribution flows through the already-designed Kafka + gRPC asynchronous pipeline, independent of the HTTP request's lifecycle.
2. Idempotency design: use `report_id + trigger time window (e.g., COB date)` as the idempotency key. Upon receiving a request, first check whether an in-progress or completed task with the same key already exists; if so, return the existing task_id directly instead of creating a new one — preventing cron-platform retries from causing duplicate execution.
3. Stage-level intervention: once task state is persisted, operators can query which stage a task is stuck at; the system should offer the ability to "retry from a specific stage" (e.g., re-running only the downstream stage) rather than blindly re-running the entire flow, and should offer manual cancellation (governed by the state machine's legal-transition table to determine which states permit cancellation).
4. Migration smoothness: the endpoint's URL and calling convention (curl POST) can remain unchanged, so the company's several hundred existing cron job configurations require no changes — only the implementation behind the endpoint changes, from synchronous completion to asynchronous acceptance.
5. A semantic change that needs to be communicated to the cron-platform maintainers/business stakeholders: in v1, HTTP 200/timeout/500 directly indicated report success or failure; in v2, a 202 only means the task was accepted, not that the report actually finished. If the cron platform supports polling/callbacks, it can poll a status endpoint after receiving the 202 until a terminal state is reached, preserving the "success/failure" semantics for its users. If it does not support this, then visibility into whether a report truly completed needs to move to the Monitor service — this coordination cost should be estimated in advance.

## Full Lifecycle Sequence Diagram (Trigger → Terminal State)

```
Participants: Cron Platform / Report Engine / MongoDB / Kafka / Data API Server /
              Shared Storage (NFS, near-term) / Data Processor / Monitor / Downstream Systems (FTP/Email)

 1. Cron Platform     --POST /go-report(report_id, cobDate)-->     Report Engine
 2. Report Engine     --Idempotency check(report_id+cobDate)-->    MongoDB
      2a. If a task with the same key already exists → take its task_id, skip to step 4
      2b. Otherwise: generate task_id, clone the report config into a Task, state=REQUESTED, write to MongoDB
 3. Report Engine     --Publish Kafka event: task.created(task_id)-->    Kafka
 4. Report Engine     --202 Accepted + task_id-->                  Cron Platform
                          (The HTTP request ends here; everything below proceeds asynchronously)

 5. Report Engine     State update: REQUESTED → DATA_FETCHING, persisted (MongoDB)
 6. Report Engine     --Feign/DNS call requesting raw data(report_id, cobDate)--> Data API Server
 7. Data API Server   Queries source data → lands Parquet to shared storage (NFS) → returns data_ref
 8. Report Engine     State update: DATA_FETCHING → PROCESSING, persisted
 9. Report Engine     --Publish Kafka task message{task_id, data_ref, DSL, dsl_version}--> Kafka
10. Data Processor    Consumes task message → reads Parquet from shared storage via data_ref
                       → runs pandas filter/merge/assign/aggregate per the DSL
11. Data Processor    --Publish Kafka completion event{task_id, status, instance_addr}--> Kafka
                          (Near-term approach: carries its own instance address so the Engine
                            can pull directly via gRPC, avoiding the case where multi-instance
                            load balancing routes to an instance that never handled this task;
                            future approach: see the Redis result-reference design under
                            "Future Directions" below)
12. Report Engine     Consumes the completion event → idempotency check (skip if already READY/DELIVERED)
                       → issues a gRPC ProcessReport call to instance_addr to pull the result (Arrow IPC streaming)
      12a. If the pull fails or times out → check whether data_ref/raw data is still within its TTL
             → Within TTL: roll state back to PROCESSING, redispatch the task message (trigger recomputation)
             → Beyond TTL: state update to FAILED, log the reason, await manual intervention or an
               automatic full-flow retry per policy
13. Report Engine     Receives the complete DataFrame → runs the internal chain of responsibility:
                       checkrule highlighting → table/file assembly & rendering → report assembly
14. Report Engine     State update: PROCESSING → READY, persisted
15. Report Engine     Internal chain triggers the downstream handler, distributing to downstream
                       systems (FTP/Email, etc.)
      15a. Distribution succeeds → State update: READY → DELIVERED (terminal) → publish Kafka status event
      15b. Distribution fails → State update: READY → FAILED (terminal, but the downstream stage
             alone may be retried)
16. Monitor           Consumes the status event stream (especially FAILED states) → notifies relevant
                       users via configured channels

 —— The following are optional operator/business-stakeholder interaction paths ——
17. Cron Platform / Human --GET /go-report/{task_id}/status-->     Report Engine
                          (Poll or query the task's current/terminal state on demand — for cron
                            platforms that don't yet support async semantics, or for manual
                            troubleshooting)
18. Human (Ops)       --POST /go-report/{task_id}/retry?fromStage=downstream-->
                                                                     Report Engine
                          (Re-runs only the specified stage, without re-fetching data or
                            reprocessing)
19. Human (Ops)       --POST /go-report/{task_id}/cancel-->        Report Engine
                          (Manual cancellation, gated by the state machine's legal-transition
                            table to determine whether the current state permits cancellation)
```

## Open Points

1. In step 11, "carrying its own instance address for direct pull by the Engine" is a lightweight stopgap for the near term, given that Redis is not yet being introduced. The risk: if that Data Processor instance restarts or is scaled down before the Engine completes the pull, the pull will still fail and trigger the recomputation path. Whether this risk is acceptable needs to be evaluated against the actual lifecycle stability of Data Processor instances.
2. Need to confirm whether the company's cron platform supports asynchronous task modes (status polling, webhook callbacks) — this directly determines how visibility into "the report has truly completed" is surfaced to existing operational monitoring habits, and needs to be aligned with the platform's maintainers/business stakeholders in advance.
3. The specific permission controls for the "retry from a specific stage" endpoint (who can trigger a retry, which stages may be retried individually) have not yet been designed.

See the main document: [../genie-v2-architecture-notes-en.md](../genie-v2-architecture-notes-en.md).
