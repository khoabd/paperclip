---
name: documentation-handoff
description: >
  Write clear technical documentation, READMEs, runbooks, and handoff notes.
  Use when shipping a feature, onboarding a new team member, or documenting a
  system. Activate with: "write docs", "document this", "README", "runbook",
  "handoff", "changelog".
---

# Documentation & Handoff

Write for the person who has no context. That person is future you.

## README Template

```markdown
# Project Name
One sentence description.

## Quick Start
\`\`\`bash
npm install && npm dev
\`\`\`

## Architecture
[Diagram or brief description]

## Configuration
| Variable | Description | Default |
|----------|-------------|---------|
| PORT     | Server port | 3000    |

## Development
How to run tests, linting, build.

## Deployment
How to deploy. What can go wrong.
```

## Runbook Template
```markdown
## Incident: [Name]
**Symptoms:** What operators see
**Impact:** Who is affected
**Diagnosis:** Steps to confirm
**Mitigation:** Stop the bleeding
**Fix:** Root cause resolution
**Escalation:** Who to call
```

## Changelog Format
```
## [1.2.0] - 2026-04-28
### Added
- Feature X for users who need Y
### Fixed  
- Bug Z that caused W
### Breaking
- Config key renamed from A to B
```

## Red Flags
- README with no quick start
- Docs that explain WHAT (the code does that)
- No runbook for critical services
- Changelog with just "bug fixes"
