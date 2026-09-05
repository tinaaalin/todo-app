# Module Detail: Data Processor

## Core Features

1. A general-purpose vectorized data processor, replacing the filter/aggregate and similar business-processing logic that was hardcoded in Java Streams in v1.
2. Receives an operator DSL dispatched by the Report Engine (filter/merge/assign/aggregate, etc.) and executes it against a DataFrame per the declarative configuration; free-form expressions or eval execution are not accepted.
3. The operator set is a whitelisted enumeration with parameterization, eliminating both security and maintainability risks.
4. The operator DSL carries a version number, supporting DSL evolution without impacting the full set of reports (the specific routing mechanism is still to be worked out — see Open Questions).
5. Reads raw data directly from shared object storage (via a reference, without passing through the Report Engine) and streams the result back over gRPC once processing is complete.

## Tech Stack

1. Python — the only service that must be deployed independently for a technology-stack reason (vectorized computation capability).
2. pandas / numpy, handling the actual vectorized filtering, merging, and aggregation operations.
3. pyarrow, used to read raw data in Parquet format and to encode processed results as Arrow IPC.
4. gRPC Server (Python-side grpcio), exposing streaming RPC interfaces such as `ProcessReport`.
5. Kafka Consumer (Python client), receiving task messages dispatched by the Report Engine; also acts as a Producer to emit completion events once processing finishes.
6. nacos-sdk-python (needed only if Nacos is introduced for service discovery in the future; not a required dependency at this stage).

## Data-Processing and Transfer Design

1. The Data Processor remains stateless and carries no persistence responsibility; by default, the processed intermediate result is not landed anywhere — it is streamed directly to the Report Engine via gRPC and released once sent.
2. The processed data is typically smaller than the raw data (row/column counts shrink after filtering/aggregation), so the cost of streaming it is already lower than the cost of landing the raw data.
3. Parquet and Arrow IPC belong to the same Apache Arrow ecosystem, and pyarrow can convert between them at near-zero cost — the entire pipeline never needs to detour through JSON or a row-oriented format.
4. Chunks should be kept to a few MB each to avoid impacting gRPC flow control; gRPC streaming natively supports backpressure, allowing the Data Processor to pause sending further chunks if the Report Engine can't keep up, preventing its own memory from being overwhelmed.
5. mTLS (mutual certificate authentication) is recommended for the internal channel.

## Instance-Affinity Problem (relevant under multi-instance deployment)

1. If a processed result only exists in the memory of the specific instance that produced it, the Report Engine — having obtained an instance via service discovery — might well be routed to any healthy instance in the cluster, quite possibly one that never handled this particular task. Under horizontal scaling with multiple instances, this is a problem that will inevitably occur, not a rare edge case.
2. Direction for a fix: processed results should not be bound to a specific instance's memory. They should instead be written to shared, TTL-bound storage (e.g., Redis — see Future Directions), with the Kafka completion event carrying a result reference (including expires_at), keeping this architecturally symmetric with the "land + pass-by-reference" pattern used for raw data.
3. The current default approach is "retry means recompute," and a shared result-cache layer is not being introduced for now (see "Future Directions" below).

## Future Direction: Result Cache Layer (Redis)

1. Scenario: once processing completes and the Report Engine pulls the result via gRPC, if a retry is needed due to a timeout, it would be desirable to avoid re-running the pandas computation from scratch — this would also resolve the instance-affinity problem described above.
2. Rationale for introduction: processed results could be written to Redis keyed by task_id with a short TTL, so a retry request hits the cache directly, saving recomputation cost — particularly useful for reports with long processing times.
3. Cost of introduction: this adds an entirely new middleware product line, requiring the team to have deployment, monitoring, capacity-planning, and high-availability capability for Redis — which is in tension with the current infrastructure-consolidation principle.
4. Reason for deferral: the default approach (retry means recompute) already covers the current scenario, provided the raw data's TTL is noticeably longer than the potential retry window for a processed result. Only once real-world measurements show that recomputation cost is significantly higher than the complexity of introducing a cache layer would this need to be reassessed.
5. If this is eventually needed, reusing existing object storage (an S3 prefix with a short TTL) should be preferred over introducing a new Redis component, unless latency requirements are strict enough to require Redis specifically.

See the main document: [../genie-v2-architecture-notes-en.md](../genie-v2-architecture-notes-en.md).
