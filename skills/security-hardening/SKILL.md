---
name: security-hardening
description: >
  Identify and fix security vulnerabilities in code and infrastructure. Use when
  reviewing for security, hardening an API, or responding to a security issue.
  Activate with: "security review", "harden this", "check for vulnerabilities",
  "OWASP audit".
---

# Security & Hardening

Assume breach. Defense in depth. Least privilege always.

## OWASP Top 10 Checklist

1. **Injection** — parameterized queries, never string concat for SQL/commands
2. **Auth** — strong password policy, MFA, session expiry, JWT validation
3. **Sensitive data** — encrypt at rest + transit, no secrets in logs/code
4. **XXE** — disable external XML entity processing
5. **Access control** — check authorization on every endpoint
6. **Security misconfiguration** — no default creds, headers set, CORS locked
7. **XSS** — escape all output, Content-Security-Policy header
8. **Insecure deserialization** — validate/sanitize all deserialized input
9. **Known vulns** — run `npm audit` / `pip-audit` / `trivy` regularly
10. **Logging** — log auth events, no PII in logs, alerting on anomalies

## Hardening Actions
- Set security headers: `X-Frame-Options`, `HSTS`, `CSP`, `X-Content-Type-Options`
- Rate limit all auth endpoints
- Rotate secrets on compromise suspicion
- Scan containers with trivy before deploy

## Red Flags
- `eval()` on user input
- MD5/SHA1 for passwords
- HTTP (not HTTPS) in production
- Secrets in `.env` committed to git
