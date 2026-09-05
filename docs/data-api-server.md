# Module Detail: Data API Server

## Core Features

1. Uniformly ingests data from various source systems (across different business domains) and exposes a standardized REST API, replacing the raw SQL + reflection-based calls that were scattered across the service layer in v1.
2. Receives query requests from the Report Engine (report_id, COB date, business-specific filter conditions, etc.) and executes the data query.
3. Lands query results to shared object storage (rather than returning the data body synchronously) and returns a lightweight data reference to the caller.
4. Serves as the entry point for raw-data lifecycle management, including the landing format and generation of reference metadata.

## Tech Stack

1. Java + Spring Boot as the base service framework.
2. JDBC/connection drivers appropriate to each business data source (replacing the raw SQL logic previously coupled into the service layer; needs to be wrapped in an adapter layer organized by business domain).
3. A Parquet-writing library (e.g., Apache Parquet Java / Avro-Parquet), for landing query results in columnar storage format.
4. S3/MinIO SDK (or the SDK for the company's existing object-storage platform), for uploading landed files and generating reference addresses.

## Data-Landing Design (Raw Data Stage)

1. Does not pass through the Report Engine: the Engine is an orchestration layer, and routing hundreds of thousands of rows through its memory/network would be a pure waste, forcing the orchestration layer to bear I/O pressure it shouldn't have to.
2. Storage format is Parquet, landed on S3/MinIO. Rationale: columnar compression keeps the footprint small; pandas/pyarrow reads efficiently and supports column pruning; once landed, data is replayable (a failed processing run can simply re-read the same file rather than re-querying the source, which matters for COB recomputation scenarios); and when something goes wrong, the file can be downloaded directly for inspection, which is audit-friendly.
3. Example reference content: `{data_ref, format, row_count, schema_version, ttl}`.
4. Access isolation: buckets/prefixes are separated by report business domain, paired with IAM restrictions so that downstream services (Data Processor) can only read data within their own task scope.
5. Lifecycle: a lifecycle policy is set (e.g., automatic cleanup at T+3 days); long-term audit needs are handled via a separate final-result archival pipeline, not by archiving intermediate raw data.

## Open Points

1. Whether S3/MinIO can reuse the company's existing object-storage platform or needs to be newly built requires an infrastructure inventory check to confirm.
2. The specific boundaries and interface contract for splitting the data-source adapter layer by business domain have not yet been designed.

See the main document: [../genie-v2-architecture-notes-en.md](../genie-v2-architecture-notes-en.md).
