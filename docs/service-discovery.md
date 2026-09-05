# Module Detail: Inter-Service Calling and Service Discovery

## Core Features (Near-Term Plan)

1. Inter-service calls are made by resolving fixed Service names via DNS, without introducing a dedicated service-discovery middleware.
2. OpenFeign provides declarative HTTP client capability, simplifying the code organization of cross-service calls.
3. Circuit-breaking and retry capabilities (e.g., Resilience4j) are decoupled from the service-discovery mechanism and introduced independently, unaffected by the choice of discovery approach.

## Tech Stack (Near Term)

1. DNS (e.g., resolution of Service names via K8s's native CoreDNS), serving as the service-discovery mechanism.
2. `spring-cloud-starter-openfeign` (this single dependency only, without the LoadBalancer or service-discovery-related starters).
3. K8s Service's own network-layer load balancing (kube-proxy/iptables) handles client-side load balancing, without additionally introducing Spring Cloud LoadBalancer.

## Design Considerations Behind the Near-Term Plan

1. Abandoned the original idea of using ZooKeeper for service discovery: ZK is a CP system that sacrifices availability during network partitions to preserve consistency, whereas service discovery is better suited to an AP model; ZK also carries a heavier operational mental burden.
2. Eureka has entered Netflix's official maintenance mode — only bug fixes, no new features — with its ecosystem essentially stagnant, and is therefore not pursued as a direction.
3. OpenFeign itself does not require a registry — it can be configured with a fixed URL or rely on K8s Service name resolution — so choosing the DNS approach does not impede normal use of Feign.
4. This plan balances the desire to "try out the Feign component within the Spring Cloud ecosystem" with the discipline of "avoiding premature adoption of a full service-discovery stack."
5. The upgrade path from "lightweight Feign + DNS" to the full "Feign + Nacos + LoadBalancer" stack is smooth — Nacos can be introduced later without requiring a rewrite.

## Future Direction: Nacos (Service Discovery and Configuration Management)

1. Scenario: after adopting a microservices architecture in v2, service discovery and unified configuration management were needed, and the original idea was to have Nacos handle both responsibilities directly.
2. Rationale for introduction: Nacos officially supports both service discovery (switchable between AP/CP) and configuration management (including a web console, gray releases, and historical version comparison), with a mature ecosystem that fits better with the current Spring Cloud direction than ZooKeeper/Eureka.
3. Cost of introduction:
   - Requires standing up and maintaining a Nacos cluster (at least 3 nodes recommended for production).
   - Configuration-management functionality depends on an external relational database: the company has no MySQL, and the existing Oracle only has an unofficial community adaptation (fragmented across versions, with no official security updates — not recommended for production use), so a PostgreSQL instance or schema would need to be requested separately.
   - Would need to verify that nacos-sdk-python works within the company's internal network environment (Nexus private repository, SSL-inspecting proxy) for the Python-based Data Processor.
   - If approval-workflow integration is added later, an additional config-publishing gateway service would need to be developed and maintained (see [config-management.md](config-management.md)).
4. Reason for deferral: the current number of services is small, and DNS + lightweight Feign already meets inter-service calling needs; the granularity of the microservice split itself is also fairly conservative (the Data Processor is the only service with a clear, independent-deployment rationale) — this does not yet cross the scale threshold that would necessitate a unified service-discovery-and-configuration center.
5. Conditions that would trigger future adoption: a significant increase in the number of services, a need for dynamic service discovery/gray routing capability, or the automation of approval-workflow-linked configuration changes becoming urgent. At that point, the approval-gateway plan described in [config-management.md](config-management.md) could be implemented directly.

## Background Knowledge on Nacos (for reference when it is introduced in the future)

1. Nacos ships with a web console covering service management, configuration management, namespace/group management, permission management, and cluster-status viewing — friendlier than the lack of a native management UI in ZK/Eureka.
2. Service-discovery data is stored in memory by default and synchronized across cluster nodes via the Raft protocol, without being persisted; configuration-management data needs to be persisted to an external relational database.
3. The official persistence backend supports MySQL and PostgreSQL, but not MongoDB or Oracle (the latter has only an unofficial community adaptation).
4. If PostgreSQL is used as the persistence backend, it is recommended to request a new schema on the company's existing PostgreSQL instance rather than standing up new hardware/a new cluster on its own — the data volume is very small (tens to a few hundred configuration records).

See the main document: [../genie-v2-architecture-notes-en.md](../genie-v2-architecture-notes-en.md).
