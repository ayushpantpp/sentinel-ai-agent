# Database connection-pool saturation

Connection-pool saturation commonly appears as an increase in request queue
time, followed by payment API timeouts. Confirm active connections, waiting
connections, and query duration. The safe first mitigation is to pause
non-critical batch jobs after approval. Escalate to the database on-call when
waiting connections remain above 80 percent of pool capacity for ten minutes.
