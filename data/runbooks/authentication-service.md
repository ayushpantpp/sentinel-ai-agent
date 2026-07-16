# Authentication service degradation

If login failures exceed 10 percent for five minutes, declare a SEV-2 incident.
Check identity-provider latency, token-signing key availability, and recent
configuration deployments. Do not disable token validation. A rollback requires
the authentication service owner and incident commander to approve the change.
