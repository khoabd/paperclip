---
name: product-discovery
description: >
  Proactively discover, validate, and prioritize new product features through
  user research, data analysis, and opportunity mapping. Use when exploring what
  to build next, validating feature ideas, or synthesizing user feedback into
  roadmap items. Activate with: "what should we build", "feature ideas",
  "product opportunities", "user pain points", "roadmap planning".
---

# Product Discovery

Discover problems worth solving before committing to solutions.

## Discovery Loop (run weekly)

1. **Collect signals** — gather from: user feedback issues, support tickets,
   competitor changelog, industry news, internal team requests
2. **Identify patterns** — cluster signals into problem themes
3. **Score opportunities** — impact × confidence ÷ effort
4. **Write opportunity briefs** — one per validated problem
5. **Create backlog issues** — with priority and acceptance criteria
6. **Report to CEO/PM** — weekly discovery digest

## Opportunity Scoring Matrix

```
Score = (User Impact × Business Value) / Dev Effort
  User Impact:    1=nice-to-have, 3=noticeable, 5=significant pain
  Business Value: 1=low, 3=medium, 5=strategic
  Dev Effort:     1=large, 3=medium, 5=small (inverted)
```

## Opportunity Brief Template

```markdown
## Opportunity: [Name]
**Problem:** Who has what pain, and how often?
**Signal sources:** [list of evidence]
**Proposed solution hypothesis:** [1-2 sentences]
**Success metric:** [measurable outcome]
**Effort estimate:** S/M/L
**Score:** [impact × value / effort]
**Recommended action:** Build / Validate more / Defer / Reject
```

## Research Sources to Check
- Recent `support` issues in Paperclip
- Recent `feedback` or `bug` labels
- Competitor changelogs (search web)
- HackerNews "Ask HN" relevant threads
- Reddit communities in our domain
- G2/ProductHunt reviews of competitors

## Output Format
Create a Paperclip issue titled:
`[Discovery] Weekly Feature Opportunities - [Week]`
With findings, scored opportunities, and top 3 recommendations.

## Red Flags
- Building without user signal
- Score based on gut feeling, not evidence
- Skipping competitive landscape check
- No success metric defined
