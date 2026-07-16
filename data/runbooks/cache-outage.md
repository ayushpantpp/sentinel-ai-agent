# Redis cache outage

Symptoms include elevated database load, increased read latency, and cache
connection errors from multiple services. Confirm Redis endpoint health and
connection failures before changing application configuration. Enable cache
bypass only for services with an approved degraded-mode path. Do not flush the
cache during an incident because it can amplify database load.
