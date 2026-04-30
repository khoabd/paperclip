---
name: git-workflow
description: >
  Manage branches, commits, and releases using Git best practices. Use when
  starting features, creating PRs, resolving conflicts, or managing releases.
  Activate with: "create a branch", "commit message", "merge conflict",
  "git workflow", "release branch".
---

# Git Workflow & Versioning

One commit = one logical change. Branch names describe work. PRs are small.

## Branch Strategy (GitHub Flow)

```
main ──────────────────────────────────── (always deployable)
       └── feature/ATO-123-add-login ── (short-lived)
       └── fix/ATO-456-null-pointer ──
       └── release/v1.2.0 ────────────  (optional for scheduled releases)
```

## Commit Message Format
```
type(scope): short description

Body explaining WHY (optional, 72 char wrap)

Refs: ATO-123
```
Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`

## PR Checklist
- [ ] Branch named with issue ID: `feat/ATO-123-description`
- [ ] Commits are atomic (one logical change)
- [ ] PR description explains WHY not WHAT
- [ ] Tests pass
- [ ] No merge conflicts
- [ ] Linked to issue

## Versioning (SemVer)
- `MAJOR.MINOR.PATCH`
- MAJOR: breaking change
- MINOR: new feature, backward compatible
- PATCH: bug fix

## Red Flags
- Committing directly to main
- `git push --force` on shared branches
- Commits with message "fix" or "wip"
- PRs with 50+ files changed
