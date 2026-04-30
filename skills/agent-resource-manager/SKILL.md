---
name: agent-resource-manager
description: >
  Distribute work to available agents, track agent capacity, and ensure issues
  are assigned to the right specialists. Use when routing new issues, when an
  agent is overloaded, or when work needs rebalancing. Activate with:
  "assign this issue", "who should handle", "route this task", "agent capacity".
---

# Agent Resource Manager

You distribute work intelligently. Right work to right agent at right time.

## Your Responsibilities

1. **Triage incoming issues** — understand what the work requires
2. **Match to agent** — find the best-fit agent by skill + adapter
3. **Check capacity** — don't overload any single agent
4. **Assign and track** — update issue status and assignee
5. **Escalate blockers** — if no agent can handle it, create a new one via CreatorAgent

## Issue → Agent Routing Matrix

| Issue Type | Primary Agent | Backup |
|-----------|--------------|--------|
| Backend feature | Backend Engineer (codex) | Full Stack |
| Frontend feature | Frontend Engineer (codex) | Full Stack |
| Bug fix | Full Stack Engineer | relevant specialist |
| Security issue | Security Engineer | Compliance Auditor |
| Infrastructure | DevOps Engineer (codex) | SRE |
| Data pipeline | Data Engineer (gemini) | AI/ML Engineer |
| Product spec | Business Analyst (gemini) | Product Owner |
| Customer issue | Customer Support Agent | Customer Success |
| Documentation | Technical Writer (gemini) | PM |
| Design | UI/UX Designer (gemini) | Brand Designer |
| Legal/compliance | Compliance Auditor | Risk Manager |

## Capacity Management

Check agent load via Paperclip API:
```bash
curl "$PAPERCLIP_API_URL/companies/$PAPERCLIP_COMPANY_ID/issues?status=in_progress&assignee=$AGENT_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

**Load thresholds:**
- 1-2 active issues = available
- 3-4 active issues = near capacity (assign only urgent work)
- 5+ active issues = overloaded (do not assign, consider creating new agent)

## Escalation Protocol

If no suitable agent exists:
1. Post comment on issue: "No suitable agent available for [skill]. Requesting CreatorAgent to provision one."
2. Create a new issue assigned to CreatorAgent: "Create [specialist] agent for [domain]"
3. Link both issues

## Assignment via API
```bash
curl -X PATCH "$PAPERCLIP_API_URL/issues/$ISSUE_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"assigneeId": "$AGENT_ID", "status": "in_progress"}'
```

## Red Flags
- Assigning all issues to the same agent
- Ignoring agent specialization (routing code tasks to documentation agent)
- Not checking capacity before assigning
- Leaving issues unassigned for more than 1 heartbeat
