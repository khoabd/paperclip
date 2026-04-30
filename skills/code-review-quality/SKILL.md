---
name: code-review-quality
description: >
  Systematically review code for correctness, security, performance, and
  maintainability. Use when reviewing PRs, auditing existing code, or before
  merging. Activate with: "review this code", "audit PR", "code quality check",
  "what's wrong with this".
---

# Code Review & Quality

Review for what matters. Don't nitpick style — enforce correctness and safety.

## Review Checklist

### Correctness
- [ ] Does it do what the spec says?
- [ ] Are edge cases handled?
- [ ] Are errors handled and surfaced correctly?

### Security
- [ ] No secrets or credentials in code
- [ ] Input validated at boundaries
- [ ] No SQL injection / XSS / command injection
- [ ] Auth checks on every protected endpoint

### Performance
- [ ] No N+1 queries
- [ ] No unbounded loops over large datasets
- [ ] Appropriate caching where needed

### Maintainability
- [ ] Function names describe what they do
- [ ] No function > 50 lines
- [ ] No magic numbers without constants
- [ ] Dead code removed

## Severity Levels
- **BLOCK** — must fix before merge (security, correctness)
- **SUGGEST** — recommended improvement
- **NIT** — optional style/preference

## Red Flags
- Function doing more than one thing
- Comment explaining what (not why)
- Copy-paste duplication > 3 times
