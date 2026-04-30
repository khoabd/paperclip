---
tags: [architecture, git, branch, tag, release-train, hotfix, cross-repo, worktree]
date: 2026-04-29
status: design
depends_on:
  - "[[Development-Flow-and-Release-Strategy]]"
  - "[[Cross-Repo-Coordination-and-Decision-Hardening]]"
  - "[[Knowledge-Base-Management-Strategy]]"
  - "[[Autonomous-Operations-and-Human-Gate-Design]]"
---

# Git Branch / Tag / Release Train Strategy

> Vá gap: `Development-Flow §4-5` cover branch & cherry-pick **per single repo**. `Cross-Repo §1` có saga deploy nhưng không định nghĩa branch/tag mechanics khi feature span N repos, cũng không trả lời rõ "stag có bug, dev đang dirty với feature mới — hotfix thế nào". Doc này resolve.

## 1. Hai câu hỏi cụ thể cần trả lời

### Q1. Cross-repo feature → release lên dev/stag thì branch nào?
> "Feature thanh toán split-payment đụng api-repo, admin-repo, mobile-repo, billing-repo, iot-repo. Khi release lên dev hay stag, Paperclip biết phải deploy commit/branch nào của mỗi repo?"

### Q2. Hotfix stag trong khi local đang có feature mới?
> "Stag bị bug đăng nhập. Hiện main của 3 repos đã merge feature thanh toán mới (chưa lên stag). Nếu hotfix từ main, kéo theo cả feature thanh toán → không được. Logic xử thế nào?"

## 2. Quyết định cốt lõi (cần biết trước khi đọc tiếp)

| Decision | Chọn | Lý do |
|---|---|---|
| Branch model per repo | **Trunk-based** (main + short-lived branches) | Tránh long-lived dev/stag branches → merge nightmare cross-repo |
| Promotion model | **Tag-driven**, KHÔNG branch-driven | 1 commit = 1 artifact; promote = đổi tag, không cherry-pick lung tung |
| Cross-repo binding | **Release Train** entity | Bundle N (repo, sha) thành 1 logical release |
| Long-lived env branches | **NONE** (no `dev`/`stag`/`prod` branch) | Env là tag pointer + deployment manifest |
| Hotfix isolation | **Worktree** + **release/x.y maintenance branch** | Không đụng main đang dirty |
| Feature toggling | **Feature flag first**, branch chỉ khi infra change | Cho phép merge sớm, kiểm soát phơi sáng riêng |
| Tag scheme | **SemVer per repo** + **composite Train tag** | Chuẩn industry + đủ thông tin trace |

**Quy tắc bất di:** main luôn deploy được. Tag là artifact bất biến. Env là pointer.

## 3. Branch model per repo

### 3.1 Sơ đồ

```
main ─────●─────●─────●─────●─────●─────●─────●──→
          ↑     ↑                 ↑
          │     │                 │
   feature/X  feature/Y    hotfix/Z (từ main HOẶC tag)
   (short)    (short)      (short)

Long-lived (chỉ tạo khi cần):
  release/2.4.x ────●─────●─────●──→  (maintenance: cherry-pick từ main)
                    ↑           ↑
              hotfix/Z       v2.4.3
```

### 3.2 Loại branch

| Branch | Lifetime | Tạo bởi | Khi nào |
|---|---|---|---|
| `main` | Forever | Manual setup | Default |
| `feature/<feature_id>-<slug>` | < 7 ngày | Engineer agent | Mỗi task issue |
| `fix/<issue_id>-<slug>` | < 3 ngày | Engineer agent | Bug fix non-urgent |
| `hotfix/<incident_id>-<slug>` | < 1 ngày | Ops agent | Production critical |
| `release/<major>.<minor>.x` | Forever (đến EOL) | Release Manager | Khi cần maintain version cũ song song |
| `design/<design_id>-prototype` | < 14 ngày | Architect agent | Prototype, không merge |

KHÔNG dùng: `dev`, `develop`, `staging`, `stage`, `production`, `prod` làm tên branch. Đây là **environment**, không phải branch.

### 3.3 Branch protection rules (per repo, auto-applied)

```yaml
main:
  require_pr: true
  required_reviewers: 1  # có thể là agent role nếu rule cho phép
  required_checks: [ci, security_scan, contract_diff, cross_tenant_leak_check]
  require_linear_history: true   # rebase only, no merge commits
  delete_head_after_merge: true

release/*:
  require_pr: true
  required_reviewers: 1 (human, không cho agent thuần)
  required_checks: [ci, security_scan]
  cherry_pick_only_from: main    # enforced bởi PR Gate
```

## 4. Tag scheme

### 4.1 Per-repo SemVer

```
v<major>.<minor>.<patch>[-<prerelease>][+<build>]

ví dụ:
  v2.4.0           production release
  v2.4.0-rc.1      candidate
  v2.4.1           patch (hotfix)
  v2.5.0-beta.3    next minor preview
  v3.0.0-alpha.7   next major preview
```

Bump rule (auto):
- **Patch**: chỉ bug fix.
- **Minor**: feature thêm, backward compat.
- **Major**: breaking change (do contract evolution detector đánh dấu — xem `Cross-Repo §1.4`).

### 4.2 Composite Release Train tag

Khi cross-repo release, tạo 1 "Train tag" trong **release-trains** repo riêng:

```
trains/2026.04.W17.r3
  ├─ api-repo:        v2.4.0
  ├─ admin-repo:      v1.18.0
  ├─ mobile-repo:     v3.7.2
  ├─ billing-repo:    v0.9.4
  └─ iot-repo:        v1.2.1
```

Format `trains/<year>.<month>.W<week>.r<seq>` — đọc được, sort theo thời gian, không đụng SemVer cá nhân.

### 4.3 Environment pointer tags

Mỗi env có 1 **pointer tag** trỏ tới Train tag hiện tại:

```
env/dev    → trains/2026.04.W17.r4   (latest dev)
env/stag   → trains/2026.04.W17.r3   (đang stag)
env/live   → trains/2026.04.W16.r2   (đang prod)
```

Promote = move pointer:
```bash
git tag -f env/stag trains/2026.04.W17.r4
git push --force-with-lease origin env/stag
```

Demote (rollback) = move pointer ngược:
```bash
git tag -f env/stag trains/2026.04.W17.r3
```

Đây chính là answer cho Q1: **Paperclip không hỏi "branch nào", nó hỏi "Train nào"**. Train là binding của các repo SHAs/tags.

## 5. Release Train — entity chính

### 5.1 Schema

```sql
CREATE TABLE release_trains (
  id              UUID PRIMARY KEY,
  train_tag       TEXT UNIQUE NOT NULL,        -- 'trains/2026.04.W17.r3'
  feature_keys    TEXT[],                       -- ['split-payment', 'oauth-refresh']
  state           TEXT NOT NULL,                -- 'building'|'dev'|'stag'|'live'|'rolled_back'|'archived'
  built_at        TIMESTAMPTZ,
  promoted_to_dev_at  TIMESTAMPTZ,
  promoted_to_stag_at TIMESTAMPTZ,
  promoted_to_live_at TIMESTAMPTZ,
  rollback_target UUID                          -- previous train if rolled back
);

CREATE TABLE release_train_components (
  train_id    UUID REFERENCES release_trains(id),
  repo        TEXT NOT NULL,
  ref_type    TEXT NOT NULL,                    -- 'tag'|'sha'
  ref_value   TEXT NOT NULL,                    -- 'v2.4.0' or 'a1b2c3d'
  build_url   TEXT,                              -- CI artifact URL
  role        TEXT,                              -- 'producer'|'consumer'|'both' (from contract analysis)
  PRIMARY KEY (train_id, repo)
);

CREATE TABLE feature_repo_links (
  feature_key  TEXT NOT NULL,                   -- 'split-payment'
  repo         TEXT NOT NULL,
  mr_iid       INT,
  branch       TEXT,
  state        TEXT,                             -- 'planning'|'in_progress'|'merged'|'reverted'
  merged_sha   TEXT,
  merged_at    TIMESTAMPTZ,
  PRIMARY KEY (feature_key, repo)
);
```

### 5.2 Train build pipeline

Trigger: feature key X có `feature_repo_links` cho all expected repos đã đạt state `merged`. Auto-build:

```
1. Read all merged_sha từ feature_repo_links WHERE feature_key=X
2. For mỗi repo: tag SemVer mới (auto-bump dựa vào contract diff)
3. Build artifact mỗi repo, push tới registry
4. Tạo Train tag, INSERT vào release_trains state='building'
5. Run cross-repo integration tests (e2e suite)
6. Nếu pass: state='dev', move env/dev pointer
7. Notify Approval Center: "Train trains/... built, deployed dev. Promote stag?"
```

### 5.3 Promotion = move pointer + deploy

```python
def promote(train_id, target_env):
    train = get_train(train_id)
    require_human_approval_if(target_env in {"stag", "live"})
    
    # update pointer tag
    git.tag(f"env/{target_env}", train.train_tag, force=True)
    git.push("--force-with-lease", "origin", f"env/{target_env}")
    
    # tell Cross-Repo orchestrator (saga §1.5) to deploy
    saga.execute_release(
        train_id=train_id,
        target_env=target_env,
        deploy_order=train.deploy_order  # producer trước consumer
    )
    
    update_train_state(train_id, target_env)
```

**Trả lời Q1:** Paperclip không "biết branch nào" — vì không có branch dev/stag. Nó đọc Train tag, sees N (repo, tag), deploy đúng commit đó tới env target.

## 6. Cross-repo feature coordination

### 6.1 Feature ID — sợi dây xâu chuỗi

Khi PM agent tạo issue feature mới, gen 1 `feature_key` (slug-form: `split-payment`, `oauth-refresh-flow`).

Mọi MR liên quan **bắt buộc** có:
- Title prefix: `[split-payment]` 
- Body có metadata block:
  ```yaml
  ---
  feature_key: split-payment
  repo_role: producer        # hoặc consumer / both
  contract_change: true       # nếu thay đổi API/event/schema
  depends_on_repos: [api-repo, billing-repo]   # repo phải merge trước
  ---
  ```

PR Gate validate: nếu MR thiếu feature_key, hoặc feature_key không tồn tại trong feature catalog → block.

### 6.2 Feature dashboard

```sql
SELECT feature_key,
       count(*) FILTER (WHERE state='merged') AS merged_count,
       count(*) AS total,
       array_agg(repo || ':' || state) AS repos
FROM feature_repo_links
WHERE feature_key = 'split-payment'
GROUP BY feature_key;

-- output:
-- split-payment | 3 | 5 | {api-repo:merged, admin-repo:merged, mobile-repo:in_progress, billing-repo:merged, iot-repo:planning}
```

UI ở Approval Center: gauge per feature (3/5 done) + dependency graph hiển thị MR nào block MR nào.

### 6.3 Auto-build Train rule

Train tự build khi:
- Mọi repo trong `depends_on_repos` đã state=merged.
- Hoặc human-trigger "build train now" để build train partial (consumer chưa sẵn → consumer chạy với feature flag off).

### 6.4 Feature flag bridging

Khi consumer (mobile-repo) chưa merge nhưng producer (api-repo) muốn ship sớm:
- Producer ship với endpoint mới + flag `feature.split_payment` default OFF.
- Train build với api-repo nhưng KHÔNG kích flag.
- Khi consumer merge xong → tạo Train mới (rev) flip flag ON.

Quy tắc: **feature flag là ngôn ngữ chung giữa các repo**. Flag có namespace, lưu trong `feature_flags` table với `tenant_id` + `flag_key`. `Per-Tenant-Rollout-and-Compliance §2` dùng cohort canary để bật flag dần dần.

## 7. Hotfix workflow — trả lời Q2

### 7.1 Vấn đề cụ thể

```
state hiện tại của api-repo:
  main:                 a→b→c→d→e        (e = feature thanh toán mới merged)
  env/live tag:         trỏ b
  env/stag tag:         trỏ c
  env/dev tag:          trỏ e (or latest train)

stag bug found at c. Cần hotfix mà không kéo d, e (feature thanh toán).
```

### 7.2 Logic giải quyết — bước-bước

```
1. Identify base: env/stag pointer → train tag T_stag → api-repo:v2.3.5 (sha c)
2. Tạo maintenance branch nếu chưa có:
     git fetch --tags
     git switch -c release/2.3.x v2.3.5     # branch từ TAG, không phải từ main
   Nếu đã có (vì hotfix trước đó): git switch release/2.3.x
3. Tạo hotfix branch:
     git switch -c hotfix/INC-789-login-crash
4. Engineer agent fix bug, commit (1-2 commits, nhỏ).
5. PR target → release/2.3.x (NOT main).
6. CI green → auto cherry-pick lên main:
     git switch main
     git cherry-pick <hotfix-sha>     # apply same fix vào main
   Nếu cherry-pick conflict (do d, e đụng cùng file):
     → Engineer agent solve conflict
     → Hoặc Engineer agent đề xuất "fix khác" cho main vì shape code đã đổi
     → Mở 2 MR: 1 vào release/2.3.x, 1 vào main
7. Merge release/2.3.x:
     → Tag v2.3.6
     → Build artifact
     → Tạo Train tag mới ChainedFromMaintenance: trains/2026.04.W17.h1
       (h prefix = hotfix train)
     → Train chỉ chứa repo bị fix, các repo khác giữ tag cũ trong train trước
8. Promote:
     → env/stag pointer trỏ trains/2026.04.W17.h1 (verify)
     → Nếu stag verify OK → env/live pointer trỏ same train
9. Sau hotfix: dev branch không bị ảnh hưởng vì không touch main pipeline gốc.
```

### 7.3 Worktree isolation cho agent

**Quan trọng cho Paperclip:** Engineer agent thường có 1 working dir per repo. Khi đang làm feature ở main, nếu chuyển sang hotfix sẽ phải `git stash`/`switch` → mất context, có thể mất data uncommitted.

Giải pháp: **`git worktree`** — agent tạo working dir thứ 2 cho hotfix:

```bash
# Agent đang ở /workspace/api-repo/main (đang dirty với feature)
cd /workspace/api-repo/main
git worktree add /workspace/api-repo/hotfix-INC-789 release/2.3.x
cd /workspace/api-repo/hotfix-INC-789
# fix, commit, push — không động đến /workspace/api-repo/main
```

Schema:

```sql
CREATE TABLE agent_worktrees (
  id              UUID PRIMARY KEY,
  agent_id        UUID,
  repo            TEXT,
  path            TEXT,                  -- /workspace/api-repo/hotfix-INC-789
  branch          TEXT,
  purpose         TEXT,                  -- 'feature'|'hotfix'|'design'|'review'
  created_at      TIMESTAMPTZ DEFAULT now(),
  cleanup_at      TIMESTAMPTZ            -- TTL, auto-remove sau 24h idle
);
```

DevOps agent cron 1h: scan worktree quá `cleanup_at` → `git worktree remove --force` + delete row.

### 7.4 Hotfix routing decision tree (auto)

```
incident reported (incident_id, severity, env_affected)
  │
  ▼
[determine target tag]
  if env_affected = live: base = env/live tag
  if env_affected = stag: base = env/stag tag
  ▼
[determine maintenance branch]
  major.minor = parse(base_tag)  # e.g. "2.3" from v2.3.5
  if release/2.3.x exists: use it
  else: create from base tag
  ▼
[engineer agent]
  worktree add → create hotfix/INC-XXX → fix → PR to release/2.3.x
  ▼
[CI green + Approval Center expedited]
  ▼
[merge release/2.3.x → tag v2.3.6 → train h1]
  ▼
[deploy stag → verify → deploy live]
  ▼
[forward-port to main]
  cherry-pick into main, resolve conflict if any
  ▼
[cleanup worktree]
```

Toàn bộ orchestrate bởi LangGraph workflow `hotfix_handler`, kích bởi Ops agent khi incident tag = "needs-hotfix".

### 7.5 Edge case: hotfix break feature in flight on main

Cherry-pick từ `release/2.3.x` lên `main` có thể **conflict** với feature đang dở (e.g. file đã refactor mạnh).

3 outcomes có thể:
1. **Auto-merge clean** — apply, push, done.
2. **Conflict auto-resolvable** — Engineer agent re-implement fix theo shape mới của main, mở 2nd MR.
3. **Conflict không khả thi auto** — escalate Approval Center: "Hotfix forward-port cần human resolve conflict in <files>".

Forward-port deadline: 48h kể từ hotfix release. Nếu quá hạn, alert + freeze feature merge cho repo đó cho tới khi forward-port done (tránh divergence kéo dài).

## 8. Concurrent hotfix protection

Trường hợp 2 hotfix song song lên `release/2.3.x`:
- Branch protection: linear history → second hotfix phải rebase trước merge.
- Train builder: serialize per maintenance branch (lock).
- PR Gate: nếu thấy hotfix khác đang `in_review` cùng `release/x.y` → set "wait_for" dependency, agent thứ 2 chờ.

## 9. Multi-version maintenance (long tail)

Khi major version cũ vẫn chạy (v2.x cho enterprise tenant pinned, v3.x default mới):

```
release/2.x ──●─●─●→ (maintenance, security only)
              
release/3.x ──●─●─●→ (active feature dev)
              ↑
              main HEAD lives here normally
```

Tenant `pinned_version` field → tenant này deploy Train từ `release/2.x` thay vì main. Train builder build 2 trains (one per maintenance line) khi feature đụng cả 2.

EOL policy: maintenance branch sống 12 tháng sau `release/<next>.x` released, sau đó archive + force tenant migrate. Tenants nhận notice 90 ngày.

## 10. Commit message convention (Conventional Commits++)

Bắt buộc format:
```
<type>(<scope>)!?: <subject>

[body với feature_key, breaking_change, related_repos...]
```

Examples:
```
feat(billing)!: add split-payment endpoint

feature_key: split-payment
breaking_change: yes (response shape changed)
related_repos: api-repo, mobile-repo, admin-repo
deprecation_target: v2.6.0

---
fix(auth): prevent crash on empty session

incident_id: INC-789
hotfix: yes
forward_port_required: yes
```

PR Gate parse, validate, lưu vào `commits_meta` table cho tracing.

## 11. PR Gate checks (auto)

**Format / metadata:**
- MR thiếu `feature_key` (cho feature) hoặc `incident_id` (cho hotfix) → block.
- MR vào `main` mà có `hotfix:` trailer → cảnh báo, hỏi: forward-port hay re-base hotfix?
- MR vào `release/x.y` mà KHÔNG phải cherry-pick từ main → block (trừ khi maintenance-only flag).
- MR ngày càng già hơn 7 ngày → escalate, daily nag.

**Quality (per [[Testing-and-Quality-Assessment-Capability]] §15 Tier 1/Tier 2):**
- Tier 1 (mọi MR): unit ≥70% / lint / security scan / contract / a11y axe-core (WCAG 2.1 AA, 0 serious|critical) / visual regression diff < 0.1%.
- Tier 2 (Train build, before promote): cross-browser smoke (Chromium + Firefox + WebKit) / cross-device viewport / i18n locale matrix / UX heuristic LLM-as-Judge ≥ 7/10 / persona-driven E2E.
- Train không có `e2e_passed=true` → block promotion.
- Train có manual TC pending (Testing §17) → block promotion until human-executed report submitted + validated.

## 12. UX

### Approval Center
- Tab "Active Features" → liệt kê feature_key + progress per repo + Train ETA.
- Tab "Active Trains" → Train tag, repos+tags, env pointer hiện tại, "Promote" button.
- Tab "Hotfix Queue" → incident → maintenance branch → forward-port status.

### Engineer Agent UI/CLI
```
$ paperclip work pickup
> Selected task ATO-512 (feature: dark-mode)
> Worktree created: /workspace/admin-repo/feature-ATO-512
> Branch: feature/ATO-512-dark-mode (from main@a1b2c3d)
> Agent ready in 6.2s

$ paperclip work hotfix INC-789 --severity high
> Incident: login crash on stag
> Base train: trains/2026.04.W17.r3
> Affected repo: api-repo (v2.3.5)
> Maintenance branch: release/2.3.x (auto-created)
> Worktree: /workspace/api-repo/hotfix-INC-789
> Agent ready, fix scope: src/auth/session.rs
```

## 13. Implementation effort

| Phase | Effort | Output |
|---|---|---|
| Sprint 1 | 4d | Schema (release_trains, components, feature_repo_links, agent_worktrees) + Train builder |
| Sprint 2 | 3d | Tag-driven promotion + env pointer mechanic + saga integration |
| Sprint 3 | 3d | Hotfix orchestrator (LangGraph) + worktree mgmt |
| Sprint 4 | 3d | Forward-port automation + conflict escalation |
| Sprint 5 | 3d | PR Gate checks (commit format, feature_key, cherry-pick rule) |
| Sprint 6 | 2d | UX: feature dashboard + Train list + Hotfix queue |
| Sprint 7 | 2d | Multi-version maintenance + EOL policy |

Total: ~20 ngày eng work.

## 14. Score impact

Tách ra 1 dimension mới + adjust dimension cũ:

| Dimension | Trước | Sau |
|---|---|---|
| Multi-repo coordination | 9 | **9** (giữ — saga vẫn áp dụng nhưng giờ có Train concrete) |
| **Git ops & release coordination** (mới) | n/a | **9** |
| Hotfix workflow | implicit ~5 | **9** (worktree + maintenance branch + forward-port) |
| Branch hygiene | implicit ~6 | **9** (no long-lived env branches) |
| Commit traceability | implicit ~5 | **9** (feature_key xuyên suốt) |

## 15. Cross-doc updates (cần làm)

- `Development-Flow §4.1` Branch naming → cập nhật bỏ `release/v1.2.0` (đó là tag, không phải branch). Maintenance branch là `release/<major>.<minor>.x`.
- `Development-Flow §5.3` Release branch → mark deprecated, point sang doc này (`§5 Release Train`).
- `Cross-Repo-Coordination §1.2` saga schema → ref `release_trains.id` thay vì literal sha list.
- `Autonomous-Operations §3` deploy table — `branch` column → `train_tag` column.
- `00-Master §6` core tables — thêm `release_trains`, `feature_repo_links`, `agent_worktrees`.
