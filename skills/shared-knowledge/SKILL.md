---
name: shared-knowledge
description: >
  Access the shared ATOM company knowledge base using qmd CLI for hybrid
  semantic search across architecture decisions, agent specs, and company
  context. Use when you need cross-agent context, architecture decisions,
  or want to avoid duplicating work other agents have done. Activate with:
  "search knowledge", "what do we know about", "check shared KB", "look up ADR".
---

# Shared Knowledge Base

All agents share a single knowledge base. Search before you build. Document
what you learn so other agents benefit.

## Knowledge Base Location

```
~/.paperclip/instances/default/shared/
├── knowledge/
│   ├── index.md          — entry point
│   └── company.md        — ATOM company facts
└── decisions/
    └── adr-001-ai-adapters.md
```

## Search with qmd

```bash
# Keyword search (fast, exact)
qmd search "your query"

# Hybrid search (semantic + keyword, best results)
qmd query "your query"

# Pure vector/semantic search
qmd vsearch "your query"
```

## Writing to Shared KB

When you make a decision, complete research, or discover something reusable:

```bash
# Add to knowledge base
cat >> ~/.paperclip/instances/default/shared/knowledge/index.md << 'EOF'
## [Topic] — [Date]
[Your finding, decision, or context]
EOF
```

For Architecture Decisions, create a new file:
```
~/.paperclip/instances/default/shared/decisions/adr-NNN-title.md
```

## Re-indexing After Updates

After adding new content to the shared KB:
```bash
qmd index ~/.paperclip/instances/default/shared
```

## When to Use

- Before researching something: check if another agent already found it
- After completing research: add key findings to shared KB
- Architecture decisions: write an ADR and update the index
- Agent specs/capabilities: document in `knowledge/agents.md`

## Red Flags

- Doing research another agent already completed (search first)
- Making architecture decisions without checking existing ADRs
- Not documenting findings that other agents would benefit from
- Letting the KB go stale (re-index after bulk updates)
