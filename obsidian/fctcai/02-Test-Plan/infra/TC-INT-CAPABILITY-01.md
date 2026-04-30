---
id: TC-INT-CAPABILITY-01
name: Capability registry routing — match vs mismatch
layer: integration
priority: P1
phases: [P3]
status: implemented
implemented_at: 2026-04-30
test_file: server/src/platform.integration.test.ts + skill-library-hash
result: 11 pass
created: 2026-04-30
estimated_effort_hours: 4
---

# TC-INT-CAPABILITY-01 — Capability routing

## Mục tiêu
Verify capability registry route mission step đến đúng agent có skill match. Mismatch → graceful decline.

## Pre-condition
- 5 agents với capabilities đa dạng (frontend, backend, devops, qa, design)
- capability_registry table seeded
- AgentRouter class

## Steps
1. **Match case:** Mission step requires `capability=frontend.react`
   - Router select agent có capability match
   - Verify agent dispatched
2. **Mismatch case:** Mission step requires `capability=blockchain.solidity`
   - Không có agent match
   - Verify graceful decline: mission paused, approval_item tạo cho human
3. **Multiple match:** 3 agents cùng có frontend skill
   - Verify routing: WFQ scheduler quyết (workspace fairness)
4. **Capability override:** Workspace có override skill ratings
   - Verify override được tôn trọng

## Expected
- Match → dispatch
- Mismatch → graceful, không crash
- Multiple match → fair selection
- Override respected

## Acceptance checklist
- [ ] Match case: agent_id assigned đúng
- [ ] Mismatch: mission status='paused_no_capability', approval_item tạo
- [ ] Multiple match: theo dõi 100 dispatches → distribution fair
- [ ] Override: ratings từ workspace_capability_overrides used
- [ ] Edge: 0 agents available → escalate
- [ ] Audit log có entry cho mỗi routing decision

## Implementation notes
**File:** `server/src/platform/__tests__/capability-routing.integration.test.ts`

**Helpers:**
- `seedAgents(specs)`
- `dispatchStep(missionId, requiredCapability)`
- `assertFairDistribution(samples, expectedRatio)`

## Reviewer notes
> _Để trống_

## Status
- [x] Draft
- [ ] Reviewed
- [ ] Approved
- [ ] Implemented
