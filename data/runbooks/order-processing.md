# Order processing backlog

An order backlog is declared when the oldest unprocessed event exceeds five
minutes. Check consumer lag, dead-letter queue growth, and payment dependency
health. Scale consumers only after confirming the database is not saturated.
Replay dead-lettered events in batches of no more than 100 and record the replay
window in the incident timeline.
