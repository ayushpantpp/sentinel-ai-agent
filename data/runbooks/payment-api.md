# Payment API latency runbook

If p95 latency exceeds 2 seconds for five minutes, declare a SEV-2 incident.
First, check database connection-pool saturation and downstream authorization
provider latency. Do not restart the payment API until the incident commander
approves it. Capture the request error rate and database pool metrics before
making any configuration change.
