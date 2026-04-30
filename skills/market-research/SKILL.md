---
name: market-research
description: >
  Research market trends, competitor products, and industry developments to
  inform product and business strategy. Use when assessing competitive position,
  exploring new markets, or identifying technology trends. Activate with:
  "market research", "competitor analysis", "industry trends", "competitive
  landscape", "what are competitors doing".
---

# Market Research

Know the landscape before moving. Competitive advantage comes from seeing
clearly, not moving fast blindly.

## Research Loop (run bi-weekly)

1. **Competitor monitoring** — check competitor product updates, pricing, press
2. **Technology radar** — track emerging tools, frameworks, AI capabilities
3. **Market signals** — funding news, acquisition, talent movement
4. **Synthesize** — identify threats, opportunities, strategic implications
5. **Brief CEO** — create a strategic insight issue with action items

## Competitor Analysis Template

```markdown
## Competitor: [Name] — [Date]
**What changed:** [new features, pricing, positioning]
**Source:** [URL]
**Implication for us:**
  - Threat: [if any]
  - Opportunity: [gap we could fill]
  - No action needed: [if so, why]
```

## Research Commands (use in your CLI session)

```bash
# Search for competitor news
# Use your built-in web search to find:
# "[Competitor] changelog site:github.com OR site:producthunt.com"
# "[Competitor] new features 2026"
# "[industry] trends 2026"
# "best [product category] tools 2026 reddit"
```

## Technology Radar Categories
- **Adopt** — proven, use now
- **Trial** — promising, experiment
- **Assess** — interesting, watch
- **Hold** — avoid or phase out

## Weekly Monitoring Checklist
- [ ] Top 3 competitors: any product updates?
- [ ] HackerNews frontpage: any relevant posts?
- [ ] AI/LLM landscape: new models or capabilities?
- [ ] GitHub trending: any new tools in our domain?
- [ ] ProductHunt daily: new launches in our category?
- [ ] Any funding/M&A news in our space?

## Output Format
Create a Paperclip issue titled:
`[Market] Bi-Weekly Research Digest - [Week]`
With:
- 3-5 key findings
- 1-2 recommended strategic actions
- Tech radar updates if any

## Red Flags
- Research without actionable output
- Copying competitor without understanding WHY they built it
- Ignoring market signals for more than 2 weeks
- No link to product strategy
