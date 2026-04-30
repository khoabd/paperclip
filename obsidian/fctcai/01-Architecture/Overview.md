
# Architecture — Index

This section covers system architecture, design proposals, and technical decisions for FCTCAI and related systems.

## Pages

- [[00-Master-Architecture-Overview]] — **READ FIRST.** 5-layer architecture, end-to-end scenarios, glossary, cross-doc data flow, master roadmap, north star metric (2026-04-29)
- [[Paperclip-Platform-Workspace-Mission-Model]] — **FOUNDATION.** 3-layer model (Platform / Workspace / Mission): shared agent pool + skill library + tool registry, per-project isolation, cross-project learning, scheduler, capability override, refactor implication for `Company` class (2026-04-29)
- [[Autonomy-Dial-and-Progressive-Trust-Design]] — **MISSION-CRITICAL.** Policy layer for "human = gate, rest = automated": 4 autonomy levels (sandbox/low/medium/high), progressive trust counter (auto-promote capability after N successful gates), confidence-driven routing (Brier calibrated), 4 approval patterns (Confirm/Choose/Edit/Decide), gate quota + drag-in tracker, notification batching, target 30 projects in 12.5h/week (2026-04-29)
- [[Full-System-Workflow-and-Coordination]] — **OPERATIONAL FLOW.** Trigger inventory (event + cron + human), 6 end-to-end flows (daily/weekly/feature/incident/rejection/self-heal), failure handoff chain, master wiring diagram (2026-04-29)
- [[Autonomous-PM-Strategic-Loop-Design]] — Complete design for autonomous PM strategic loop: signal collection, LangGraph graph, Project Brain, Internal Auditor, Efficiency Reviewer, Knowledge Base layer (2026-04-29)
- [[Knowledge-Base-Management-Strategy]] — Multi-repo registry, technical documentation automation, cold-start bootstrap pipeline, PR-driven continuous update, coverage audit, RAG index strategy (2026-04-29)
- [[Development-Flow-and-Release-Strategy]] — Design lifecycle, conflict detection, branch strategy for AI agents, feature flags, selective release, canary rollout (2026-04-29)
- [[Autonomous-Operations-and-Human-Gate-Design]] — Unified Approval Center, CI/CD pipeline, monitoring→incident automation, security scanning, DB migration safety, agent capability registry (2026-04-29)
- [[External-Integrations-and-Environment-Strategy]] — GitLab MCP + OpenSearch MCP integration, 4-environment model (local/dev/stag/live), Paperclip as orchestrator only, log-driven incident detection (2026-04-29)
- [[UX-Strategy-and-Design]] — User personas, information architecture, 5 critical user flows, screen designs, notification hierarchy, mobile UX, empty states, auditability pattern (2026-04-29)
- [[Self-Healing-and-Liveness-Design]] — Heartbeat protocol, watchdog, stuck detection (stalled/loop/deadlock/cost runaway), kill switch with 5 levels, health score (2026-04-29)
- [[Greenfield-Bootstrap-Design]] — Idea → Project: 7-stage pipeline (refinement, market research, personas, stack, brain, scaffold, sprint 1), 4 human gates, ~$3.80 per intake (2026-04-29)
- [[Human-Intake-and-Solution-Loop-Design]] — **HUMAN HUB.** Inbound for in-flight projects: 8 intake types (problem/feature_request/bug_report/feedback_general|release|feature/strategic_input/question), 5 entry surfaces (console/email/mobile/API/MCP), per-type workflow + 3-level timeline estimation (L1 brackets / L2 Monte Carlo / L3 live), DBSCAN feedback clustering with auto-promotion (≥5/14d → intake), full integration analysis: 9 inbound triggers + 9 outbound feeds + 20 doc touchpoints (2026-04-29)
- [[Rejection-Learning-and-Feedback-Loop]] — 14-category rejection taxonomy, DBSCAN clustering, auto-adjustment (prompt/principle/velocity/rule/QA/security), "we-keep-failing-here" escalation (2026-04-29)
- [[Decision-Boundary-and-Uncertainty-Model]] — Reversibility × Blast Radius matrix + uncertainty thresholds, decision log, consistency tiers, brain snapshots, multi-agent conflict resolution (2026-04-29)
- [[Magika-Integration-and-Codebase-Triage]] — Google Magika for brownfield triage: file-type inventory, vendored/generated/binary filtering, language drift detection, supply chain security, RAG splitter routing (2026-04-29)
- [[Cross-Repo-Coordination-and-Decision-Hardening]] — Saga-style atomic deploy across repos, contract evolution + deprecation, Brier calibration, rejection genealogy, vector-clock staleness, Automation Mode hardening (2026-04-29)
- [[Git-Branch-Tag-Release-Train-Strategy]] — Trunk-based + tag-driven promotion, Release Train binding cross-repo SHAs, env pointer tags (no long-lived dev/stag branches), hotfix workflow with worktree isolation + forward-port, feature_key threading + commit conventions (2026-04-29)
- [[Testing-and-Quality-Assessment-Capability]] — 16-dimension quality matrix, visual regression + a11y + cross-browser + cross-device + mobile native + i18n + UX heuristic LLM-as-Judge + property-based fuzz + persona-driven scenarios + production synthetic probe + manual TC fallback + Test Case Browser UI (2026-04-29)
