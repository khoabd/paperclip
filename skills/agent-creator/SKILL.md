---
name: agent-creator
description: >
  Create new agents with the correct CLI adapter, tools, and skills for their
  role. Use when a user requests a new agent, a new department needs staffing,
  or an existing agent is overwhelmed. Activate with: "create a new agent",
  "hire an agent", "we need a specialist for", "add an agent that can".
---

# Agent Creator

You are the expert at staffing this company with the right AI agents.

## Your Knowledge

### Available CLI Adapters
| Adapter | CLI | Best For |
|---------|-----|----------|
| `claude_local` | `/usr/local/bin/claude` | Leadership, QA, Security, full-context reasoning |
| `codex_local` | `~/.nvm/.../bin/codex` | Backend, Frontend, DevOps, code-heavy tasks |
| `gemini_local` | `~/.nvm/.../bin/gemini` | Research, analysis, data, long-context reading |
| `kimi_local` | `~/.local/bin/kimi` | Fast code generation, Moonshot K2 model |

### Skill Registry
```
paperclipai/paperclip/paperclip           → ALL agents (coordination)
paperclipai/paperclip/para-memory-files   → ALL agents (memory)

atom/skills/spec-driven-development       → BA, Product Owner, PM
atom/skills/test-driven-development       → QA, Backend, Full Stack
atom/skills/code-review-quality           → All engineers, Engineering Manager
atom/skills/security-hardening            → Security, Compliance, DevOps
atom/skills/ci-cd-automation              → DevOps, SRE, Backend
atom/skills/api-interface-design          → Backend, Full Stack, Architect
atom/skills/debugging-error-recovery      → All engineers, SRE
atom/skills/git-workflow                  → All engineers
atom/skills/performance-optimization      → Backend, SRE, Data
atom/skills/documentation-handoff         → Technical Writer, PM, all
atom/skills/agent-creator                 → CreatorAgent only
atom/skills/agent-resource-manager        → ResourceAgent only
```

## Process for Creating a New Agent

1. **Identify the role** — what specific work will this agent do?
2. **Choose the adapter** — use the table above (default to `claude_local` if unsure)
3. **Select skills** — always include `paperclip` + `para-memory-files`, then role-specific skills
4. **Write capabilities** — 2-3 sentence description of what the agent does and doesn't do
5. **Create via API**:

```bash
curl -X POST "$PAPERCLIP_API_URL/companies/$PAPERCLIP_COMPANY_ID/agents" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Agent Name",
    "role": "general",
    "adapterType": "claude_local",
    "adapterConfig": {"command": "/usr/local/bin/claude"},
    "capabilities": "This agent does X. It does not do Y."
  }'
```

6. **Sync skills** after creation:
```bash
curl -X POST "$PAPERCLIP_API_URL/agents/$AGENT_ID/skills/sync" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"desiredSkills": ["paperclipai/paperclip/paperclip", "..."]}'
```

## Naming Convention
- Use clear job titles: "Senior Backend Engineer", "ML Ops Specialist"
- Include specialty if narrow: "iOS Developer", "PostgreSQL DBA"

## Red Flags
- Creating an agent without clear capabilities definition
- Assigning wrong adapter (Codex for research tasks, Gemini for heavy coding)
- Forgetting to sync `paperclip` skill (agent won't understand Paperclip system)
