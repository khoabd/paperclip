---
name: debugging-error-recovery
description: >
  Systematically diagnose and fix bugs, errors, and production incidents. Use
  when something is broken, a test fails, or production is alerting. Activate
  with: "debug this", "find the bug", "production issue", "error recovery",
  "root cause analysis".
---

# Debugging & Error Recovery

Reproduce first. Hypothesize second. Fix third. Never guess.

## Debug Process

1. **Reproduce** — get a reliable way to trigger the bug
2. **Isolate** — narrow down to the smallest failing case
3. **Hypothesize** — list 3 possible causes, rank by likelihood
4. **Test each** — disprove hypotheses systematically
5. **Fix root cause** — not just the symptom
6. **Add regression test** — so it never comes back
7. **Post-mortem** — document what happened and why

## Useful Commands
```bash
# Check logs
journalctl -u service-name -f
tail -f /var/log/app.log | grep ERROR

# Check process
ps aux | grep process-name
lsof -i :port

# Network
curl -v http://endpoint
tcpdump -i eth0 port 80
```

## Error Recovery Runbook
1. Identify blast radius
2. Roll back if possible
3. Mitigate (feature flag off, scale up, redirect traffic)
4. Fix forward if rollback impossible
5. Communicate status to stakeholders

## Red Flags
- "It works on my machine"
- Fixing symptoms without root cause
- No regression test added after fix
- Deploying untested fix to production
