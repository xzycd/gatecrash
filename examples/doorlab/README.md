# Doorlab

Doorlab is the local HTTP server behind `gatecrash demo`. It has five routes:

- Alice's account is incorrectly returned to Bob.
- A member export is incorrectly returned to an anonymous request.
- `/api/me` returns different data for Alice and Bob.
- `/public` is excluded by the demo config.
- A profile update uses `POST` and is skipped by the safe-method rule.

Run it through the public command:

```bash
gatecrash demo
gatecrash demo --format json --no-save
```

The server listens on a random localhost port and closes after the report is
ready. Its response data is invented and contains no external traffic.
