---
name: spec-driven-development
description: >
  Write and validate specifications before implementation. Use when starting any
  new feature, API, or system component. Ensures requirements are clear and
  testable before code is written. Activate with: "write a spec", "define
  requirements", "spec out this feature", "create acceptance criteria".
---

# Spec-Driven Development

Write the spec first. Code second. Never the reverse.

## Process

1. **Clarify scope** — identify stakeholders, inputs, outputs, constraints
2. **Write WHAT not HOW** — describe behavior, not implementation
3. **Define acceptance criteria** — concrete, testable conditions for done
4. **Review with stakeholders** — get sign-off before writing any code
5. **Implement against spec** — treat spec as the contract
6. **Verify spec is met** — run acceptance criteria as tests

## Spec Template

```markdown
## Feature: [Name]
**Goal:** [One sentence]
**Inputs:** [What goes in]
**Outputs:** [What comes out]
**Acceptance Criteria:**
- [ ] Given X, when Y, then Z
- [ ] Edge case: ...
**Out of scope:** [Explicit exclusions]
```

## Red Flags
- "We'll figure out the details as we go"
- Spec written after implementation
- No acceptance criteria defined
- Stakeholder hasn't reviewed before coding starts
