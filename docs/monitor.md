# Module Detail: Monitor

## Core Features

1. Listens for alert signals, covering abnormal states in the report lifecycle (e.g., the FAILED state) and other events requiring human attention.
2. Notifies relevant users through multiple channels (e.g., email, IM — specific channels still to be determined).
3. Subscribes to the unified Kafka event stream produced by Report Engine state-machine transitions as its source of alert signals, rather than listening to scattered signals from each service individually.

## Tech Stack

1. Java + Spring Boot (if deployed independently) or running as a module inside the Report Engine (if not yet split out).
2. Kafka Consumer, subscribing to the report status event stream.
3. SDKs for the corresponding notification channels (email/IM, etc., still to be determined).

## Whether to Split into an Independent Microservice: Still Being Evaluated

1. Whether Monitor needs to become an independent microservice, or should first run as a module inside the Report Engine, depends on the team's operational capacity and actual independent scaling needs.
2. Unlike the Data Processor (which must be deployed independently for a technology-stack reason — Python/pandas), Monitor currently has no clear, irreplaceable justification for independent deployment.
3. Per the infrastructure-consolidation principle, microservice splitting granularity should remain conservative — it is recommended to run Monitor embedded as a module for now, splitting it into an independent service only once a genuine independent-scaling need arises.

See the main document: [../genie-v2-architecture-notes-en.md](../genie-v2-architecture-notes-en.md).
