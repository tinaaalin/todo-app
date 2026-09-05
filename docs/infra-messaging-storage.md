# Module Detail: Infrastructure — Messaging and Shared Storage

This is not an independent service, but rather the data-transfer and messaging infrastructure that runs across the Report Engine / Data API Server / Data Processor — it is broken out into its own document because of its complexity and cross-module nature.

## Core Features

1. Handles cross-service task dispatch and status-event notification (Kafka).
2. Handles the transfer of raw data from the Data API Server to the Data Processor (S3/MinIO + Parquet).
3. Handles efficient transfer of processed results from the Data Processor to the Report Engine (gRPC + Arrow IPC).

## Tech Stack

1. Kafka: the messaging middleware for task-dispatch messages and status-event notifications.
2. S3/MinIO: shared landing storage for raw data.
3. Apache Parquet: the columnar storage format for raw data.
4. gRPC: the communication protocol for transferring processed results (server-streaming).
5. Apache Arrow (Arrow IPC): the serialization/encoding format for processed results, part of the same Arrow ecosystem as Parquet, with low conversion cost between the two.
6. mTLS: mutual certificate authentication for the internal gRPC channel.

## Design Principles

1. Kafka carries only control signals (metadata: task_id, status, reference addresses, etc.), never the actual data body — keeping message payloads lightweight and making full use of Kafka's persistence, consumer-group, and replay capabilities.
2. Actual data transfer (raw data, processed results) goes through dedicated data channels (object-storage references, gRPC streaming), not through the message queue.
3. The Report Engine is not a data relay point: raw data is read directly by the Data Processor from shared storage, never passing through the Report Engine's memory or network.
4. The calling direction follows an "Engine pull" model: upon receiving the Kafka completion event, the Engine actively issues a gRPC request to pull the result, rather than having the Data Processor push it back — this avoids instance-level routing problems under multi-instance Report Engine deployment.

## Raw-Data Transfer Details

1. Path: the Report Engine sends a query request to the Data API → the Data API lands the result to shared storage after querying → returns a lightweight reference to the Engine → the Engine sends that reference together with the operator DSL to the Data Processor via Kafka → the Data Processor reads directly from shared storage using the reference.
2. Example reference content: `{data_ref, format, row_count, schema_version, ttl}`.
3. Access isolation: buckets/prefixes are separated by report business domain, paired with IAM restrictions so the Data Processor can only read data within its own task scope.
4. Lifecycle: a lifecycle policy is set (e.g., automatic cleanup at T+3 days); long-term audit needs are handled via a separate final-result archival pipeline, not by archiving intermediate raw data.

## Processed-Result Transfer Details

1. The Kafka completion event carries metadata such as task_id, status, and result location.
2. The gRPC `ProcessReport` interface returns Arrow IPC-encoded data in server-streaming chunks, recommended at a few MB per chunk.
3. gRPC streaming natively supports backpressure, allowing the consumer to pause requesting further chunks if it can't keep up.
4. `ProcessReport` should be given a reasonable deadline, with the Engine re-initiating the call on timeout, using task_id for idempotency.
5. The instance-affinity problem for processed results (multi-instance deployment may route to an instance that never handled the task) and its fix (reference-based results, symmetric with raw data), are detailed in [data-processor.md](data-processor.md).

## Persistence Classification for the Three Data Types

1. Raw data: needs to be persisted, as S3 Parquet with a short TTL.
2. The processed intermediate DataFrame: does not need to be persisted by default and is streamed directly; a short-TTL cache is only considered when there is a clear need for retry optimization (see the Redis future direction).
3. The final report file: needs to be persisted — this is an existing business deliverable that already requires retention for audit purposes, following the existing report-distribution system's approach, and does not represent redundancy newly introduced by this architecture.

## Kafka Reuse Status

1. Abandoned the original idea of using ZooKeeper for inter-service signaling: ZK is positioned for coordination/service discovery rather than high-throughput message delivery, and lacks consumer-group, offset, and replay capabilities.
2. Kafka is a case of reusing existing infrastructure: the company already has production experience running Kafka on the Harbour system (SOD/Intraday topic separation, COB date recomputation, etc.); v2 simply adds new consumers/producers on the same infrastructure, incurring no new operational cost.

## Shared Storage Selection: NFS (Near Term) and S3 (Future)

### Near-Term Decision: NFS

1. The company can quickly provide off-the-shelf NFS, requiring no additional procurement/evaluation process, consistent with the principle of "consolidating infrastructure and prioritizing reuse of existing resources."
2. NFS is adopted near-term as the shared landing storage for raw data; the Data API Server and Data Processor read/write Parquet files via standard file I/O over a mounted path, without introducing the S3/MinIO SDK.

### NFS Advantages

1. Off-the-shelf at the company, zero procurement/evaluation cost, consistent with the infrastructure-consolidation principle.
2. Simpler code: both Java and Python can use standard file I/O; pyarrow reading Parquet files from a mounted path is no different from reading local disk, with no need to handle object-storage signature authentication or the bucket concept.
3. Network latency within the same data center is typically lower than calling an object store over an HTTP API, with no extra protocol overhead.
4. The company's existing NFS backup and monitoring operational experience can be reused directly.

### Specific Risks of NFS in This System

1. **No native TTL/lifecycle management**: S3's lifecycle policy provides declarative, automatic expiration; NFS requires writing custom cleanup scripts and carefully handling edge cases (e.g., a cleanup job running while a task is still reading the file) — this is a hidden extra cost in development and maintenance.
2. **Insufficient access-control granularity**: S3 can configure IAM policies per bucket/prefix for business-domain isolation; NFS typically only supports export-level control (based on IP/subnet) plus POSIX file permissions, making fine-grained isolation by report business domain difficult — this may be questioned during compliance review.
3. **Write-atomicity issues**: S3's PUT is an atomic operation; NFS, as a network filesystem, has a cache-consistency model (close-to-open semantics, which vary by version/mount options) that can lead to reads of incomplete files. The pattern of "write to a temp filename, then atomically rename to the target filename once writing completes" must be explicitly adopted and enforced as a coding standard — it cannot rely on developer discipline alone.
4. **Horizontal scaling and concurrency bottlenecks**: S3's throughput/capacity can be considered essentially infinitely scalable; NFS typically sits behind a single server or a single HA cluster — a shared, finite I/O resource. If hundreds of reports fire concurrently during a COB batch window, and that NFS instance is shared across multiple company systems, I/O contention ("noisy neighbor") may result.
5. **Containerized-environment compatibility**: if K8s is adopted in the future, NFS as a PersistentVolume requires an NFS CSI driver, which historically has had known issues such as stale file handles and inconsistent distributed-locking behavior — with a higher troubleshooting cost than native S3 API integration.
6. **Single point of failure and disaster recovery**: unless the company's NFS itself is deployed as a high-availability cluster, it should be assumed to be tied to a single physical location by default, with cross-datacenter DR/cross-region replication capability inferior to a mature object store.

### Recommended Approach: Make the Storage-Access Layer a Replaceable Abstraction

1. In the Data API Server and the Data Processor, business code should not hardcode file-path concatenation or S3 API calls directly, but instead go through a storage-access interface (e.g., `RawDataStore.write(ref) / read(ref)`).
2. An NFS implementation handles path concatenation and the "temp file + atomic rename" logic; a future S3 implementation handles the SDK calls.
3. In the near term, the "write temp file + atomic rename" pattern should be enforced, guarding against NFS's biggest atomicity risk.
4. In the near term, a lightweight, self-built scheduled cleanup job should handle TTL enforcement — even a crude version should be running from the start.
5. This abstraction design means that switching to S3 in the future only requires swapping the implementation class, without touching the business logic of the Report Engine/Data Processor — consistent with the already-adopted Strangler Fig approach, and the storage layer itself can be migrated incrementally.

### The Value and Necessity of S3 (or the on-prem S3-compatible MinIO) Going Forward

1. Native TTL/lifecycle rules: no need to write cleanup scripts — declarative configuration handles automatic expiration; the operational-burden gap versus the NFS approach becomes more pronounced as hundreds of reports run over the long term.
2. Fine-grained IAM access control: isolation by business domain via bucket/prefix, better aligned with compliance requirements for financial data.
3. Atomic write semantics: naturally avoids the "reading a half-written file" problem, without needing the extra "write temp file + rename" convention.
4. Elastic throughput and capacity: not limited by the physical I/O ceiling of a single server or single NFS cluster, better able to absorb concurrency pressure during COB peaks.
5. Cloud-native/container-friendly: if K8s or the cloud is adopted in the future, the S3 API is the de facto standard, without the known compatibility issues of NFS.

### Signals That Should Trigger a Switch to S3 (rather than a judgment call)

1. Observing clear queuing/increased latency in NFS reads/writes during the COB window.
2. The self-built cleanup script itself starts causing problems (accidentally deleting files still in use, or missed cleanups causing disk usage to spike).
3. Compliance review explicitly requires access isolation at the storage layer by business domain.
4. A decision is made to move to K8s or cloud infrastructure.

See the main document: [../genie-v2-architecture-notes-en.md](../genie-v2-architecture-notes-en.md), as well as the instance-affinity and result-cache discussion in [data-processor.md](data-processor.md).
