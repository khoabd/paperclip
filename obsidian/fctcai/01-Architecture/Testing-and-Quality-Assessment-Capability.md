---
tags: [architecture, testing, qa, quality, visual-regression, accessibility, hercules, synthetic-user]
date: 2026-04-29
status: design
depends_on:
  - "[[Autonomous-Operations-and-Human-Gate-Design]]"
  - "[[Greenfield-Bootstrap-Design]]"
  - "[[Git-Branch-Tag-Release-Train-Strategy]]"
---

# Testing & Quality Assessment Capability

> Vá gap: hiện QA dept (`src/fctcai/depts/qa/`) đã có Hercules + chaos + contract + load + pytest_runner + test_author + qa_gate + regression_tracker (8 module). Test strategy 3 layer ở Auto-Ops §3.3 cover unit/integration/E2E happy-path tốt. **Nhưng 7 dimension chất lượng còn ≤ 5/10:** visual regression, accessibility, cross-browser, cross-device, mobile native, i18n, UX heuristic, production synthetic. Doc này resolve.

## 1. Mục tiêu

- Đẩy aggregate testing score từ 4.6/10 → 8.4/10 trên 16 dimension chất lượng.
- Mọi test chạy được tự động trong CI hoặc cron (không yêu cầu human ngồi click).
- Phân biệt rõ **hard-block** (tests phải pass mới promote) vs **soft-signal** (đưa vào sprint planning).
- Trang bị "agent có mắt" — không chỉ click theo script mà còn nhìn thấy kết quả visual.
- Bridge mobile native vào cùng QA pipeline.
- Production synthetic probe = "user 24/7" để bắt regression sau khi deploy.

## 2. 16-dimension Quality Matrix — Target

| # | Dimension | Trước | Sau | Cơ chế |
|---|---|---|---|---|
| 1 | Unit test coverage | 8 | 8 | (giữ) pytest + agent forced |
| 2 | Integration test (API) | 8 | 8 | (giữ) auto-gen từ OpenAPI |
| 3 | Contract test cross-repo | 8 | 8 | (giữ) contract_tester + Cross-Repo §1.4 |
| 4 | E2E functional happy-path | 8 | 9 | Hercules + multi-engine (§5) |
| 5 | E2E edge case + negative | 5 | 8 | Property-based + fuzz (§10) + persona-driven (§11) |
| 6 | Load / performance | 7 | 8 | Baseline regression detection (§12) |
| 7 | Chaos / failure injection | 6 | 8 | Game day cron + scenario library (§12) |
| 8 | **Visual regression** | 1 | **8** | §3 Visual pipeline |
| 9 | **Accessibility (a11y)** | 1 | **9** | §4 axe-core + ARIA semantic check |
| 10 | **Cross-browser matrix** | 2 | **8** | §5 Playwright multi-engine + BrowserStack burst |
| 11 | **Cross-device responsive** | 2 | **8** | §6 Viewport matrix + screenshot diff |
| 12 | **Mobile native E2E** | 3 | **8** | §7 Appium bridge + simulator farm |
| 13 | **i18n / locale** | 1 | **8** | §8 Locale matrix + pseudo-locale stress |
| 14 | Security functional | 6 | 8 | §13 enhanced (auth/IDOR/CSRF in Hercules) |
| 15 | **UX heuristic** ("dùng được không") | 2 | **8** | §9 LLM-as-Judge with screenshot + DOM |
| 16 | **Production synthetic probe** | 3 | **9** | §14 Hercules cron on prod |

## 3. Visual Regression Pipeline

### 3.1 Stack
- **Playwright `toHaveScreenshot()`** native (giảm dep extern).
- Optional escalation: **Chromatic** (paid) cho team có designer review workflow.
- Storage: S3 + diff blob, retain 90 ngày.

### 3.2 Workflow

```
PR opened
  ├─ run Hercules E2E suite, mỗi step có `await page.screenshot()`
  ├─ compare với baseline trong `visual_baselines/<feature>/<step>.png`
  ├─ pixel diff threshold: 0.1% (configurable)
  ├─ region masking: ignore timestamp/avatar/random-id (declarative trong scenario)
  │
  └─ Output:
      • diff < 0.1%: pass
      • diff 0.1–2%: soft-warn → comment trên PR với side-by-side, không block
      • diff > 2%: hard-block, requires human "Accept new baseline" qua Approval Center
```

### 3.3 Baseline lifecycle
- Tạo baseline khi feature first merge (auto-snapshot khi tag train mới).
- Baseline gắn với train tag → có thể rollback baseline khi rollback Train.
- Pruning: baseline giữ tối đa 3 train versions, sau đó archive.

### 3.4 Schema

```sql
CREATE TABLE visual_baselines (
  id            UUID PRIMARY KEY,
  feature_key   TEXT NOT NULL,
  step_name     TEXT NOT NULL,
  viewport      TEXT NOT NULL,         -- '1440x900' | 'mobile-375x667'
  browser       TEXT NOT NULL,         -- 'chromium'|'firefox'|'webkit'
  locale        TEXT,                  -- 'en-US'
  storage_url   TEXT NOT NULL,
  train_tag     TEXT,
  approved_by   UUID,
  approved_at   TIMESTAMPTZ,
  UNIQUE (feature_key, step_name, viewport, browser, locale)
);

CREATE TABLE visual_diffs (
  id            UUID PRIMARY KEY,
  pr_iid        INT,
  baseline_id   UUID REFERENCES visual_baselines(id),
  diff_pct      NUMERIC,
  diff_url      TEXT,
  outcome       TEXT,                  -- 'pass'|'soft_warn'|'hard_block'|'accepted'
  decision_by   UUID,
  decided_at    TIMESTAMPTZ
);
```

## 4. Accessibility Pipeline (a11y)

### 4.1 Stack
- **axe-core** injected vào mọi Hercules scenario.
- **Lighthouse a11y** cho audit overall.
- **pa11y** CLI cho batch scan static pages.

### 4.2 WCAG mapping
- WCAG 2.1 AA = baseline (target).
- WCAG 2.2 AAA = nice-to-have, soft-warn only.
- Per critical level:

| axe severity | Action |
|---|---|
| critical | hard-block PR |
| serious | hard-block PR |
| moderate | soft-warn, log to backlog |
| minor | log to backlog only |

### 4.3 Scenario integration

```python
# Hercules scenario hook
async def with_a11y_check(page, step_name):
    await page.evaluate(AXE_CORE_JS)
    violations = await page.evaluate("axe.run()")
    return AxeReport(step=step_name, violations=violations)
```

### 4.4 Manual flows automated

- Keyboard-only navigation: scenario "tab through entire form, submit, verify".
- Screen-reader landmarks: assert `<main>`, `<nav>`, ARIA labels present.
- Color contrast: axe + custom check cho brand-color pairs.
- Focus trap detection: scenario "tab N times, expect focus loops within modal".

### 4.5 Schema

```sql
CREATE TABLE a11y_violations (
  id              UUID PRIMARY KEY,
  pr_iid          INT,
  feature_key     TEXT,
  rule_id         TEXT NOT NULL,         -- 'color-contrast', 'aria-required-attr'
  severity        TEXT NOT NULL,
  selector        TEXT,
  failure_summary TEXT,
  state           TEXT,                  -- 'open'|'fixed'|'wontfix_with_reason'
  detected_at     TIMESTAMPTZ DEFAULT now()
);
```

## 5. Cross-Browser Matrix

### 5.1 Stack
- **Primary**: Playwright multi-engine (Chromium + Firefox + WebKit) trong CI runner local.
- **Burst**: BrowserStack/Sauce Automate cho legacy (Edge cũ, Safari iOS thật) → chạy nightly + pre-prod, không per-PR.
- Decision rule: nếu feature đụng UI/render → multi-engine; nếu đụng API only → Chromium đủ.

### 5.2 Test matrix per criticality

| Feature criticality | Per-PR | Nightly | Pre-prod |
|---|---|---|---|
| Critical (auth, payment, checkout) | Chromium + Firefox + WebKit | + iOS Safari real | + Edge cũ |
| Standard | Chromium + Firefox | + WebKit | – |
| Internal-only | Chromium | – | – |

Criticality auto-tag từ `feature_repo_links.criticality` (PM agent set, default = standard).

### 5.3 Schema

```sql
CREATE TABLE browser_test_runs (
  id            UUID PRIMARY KEY,
  pr_iid        INT,
  feature_key   TEXT,
  browser       TEXT,                    -- 'chromium'|'firefox'|'webkit'|'edge'|'safari-ios'
  device        TEXT,
  passed        BOOL,
  failure_url   TEXT,                    -- video/trace
  duration_s    INT,
  ran_at        TIMESTAMPTZ DEFAULT now()
);
```

### 5.4 Cost control
- BrowserStack chỉ trigger khi `feature.criticality = critical` hoặc nightly cron.
- Parallel max 4 sessions để tránh queue.
- Estimate ~$50-100/tháng nếu lưu lượng feature critical < 30/tháng.

## 6. Cross-Device Responsive

### 6.1 Viewport matrix

```
mobile-portrait    : 375x667     (iPhone SE)
mobile-landscape   : 667x375
tablet-portrait    : 768x1024
tablet-landscape   : 1024x768
laptop             : 1440x900
desktop            : 1920x1080
4k                 : 3840x2160
```

### 6.2 Test matrix

- Mọi page critical chạy ít nhất `mobile-portrait + tablet-portrait + laptop`.
- Viewport-specific scenarios: "open hamburger menu on mobile", "side panel resize on desktop".
- Visual regression baseline per viewport (xem §3.4 schema có `viewport` column).

### 6.3 Layout assertion

Ngoài screenshot diff, có hard layout check:
- No horizontal scrollbar trên mobile-portrait (overflow check).
- Touch target ≥ 44×44 px (Apple HIG / WCAG 2.5.5).
- Text không bị cắt (computed style overflow: ellipsis check).

## 7. Mobile Native E2E Bridge

### 7.1 Vấn đề
`Mobile-Distribution-Pipeline-Design.md` đề cập XCUITest + Espresso nhưng QA dept hiện chỉ có Hercules (web). Cần bridge để dùng cùng natural-language scenario interface.

### 7.2 Adapter — `appium_tester.py`

```python
@runtime_checkable
class MobileTester(Protocol):
    async def run_test(
        self,
        platform: str,           # 'ios' | 'android'
        app_path: str,           # .app or .apk
        scenarios: list[BrowserTestScenario]
    ) -> MobileTestReport: ...

class AppiumTester:
    """Wrap Appium server + WebDriverAgent (iOS) / UiAutomator2 (Android)."""
    # Hercules-style NL scenarios → Appium commands via LLM translator
    # Reuse same BrowserTestScenario format

class StubMobileTester: ...  # offline fallback
```

### 7.3 Simulator farm

- iOS Simulator (Xcode) — chạy local trên CI macOS runner.
- Android Emulator (AVD) — Linux runner với KVM.
- Parallel: 1 runner = 2 simulators cùng lúc. Train job trigger 4-8 runners parallel.
- Real device: optional thông qua BrowserStack App Live cho iPhone cũ + Android low-end.

### 7.4 Test scope mobile

- Cold start: time-to-interactive < 3s.
- Push notification flow: send test push → assert app handle.
- Deep link: open URL → land đúng screen.
- Offline mode: airplane mode → verify cached state.
- Permission prompts (camera, location, push) — XCTest mock.
- Force-update modal (xem `Mobile §7.3`) appears + blocks correctly.

### 7.5 Schema

```sql
CREATE TABLE mobile_test_runs (
  id            UUID PRIMARY KEY,
  pr_iid        INT,
  feature_key   TEXT,
  platform      TEXT,
  device_label  TEXT,                    -- 'iPhone 15 Pro Sim, iOS 17'
  passed_count  INT,
  failed_count  INT,
  trace_url     TEXT,
  ran_at        TIMESTAMPTZ DEFAULT now()
);
```

## 8. i18n Test Scaffolding

### 8.1 Locale matrix
- `en-US` (default), `vi-VN`, `ja-JP`, `de-DE`, `ar-EG` (RTL test).
- Pseudo-locale `qps-ploc`: prepend/append weird chars + double length → catch hardcoded strings + truncation.

### 8.2 Tests per locale

- All visible strings come from i18n catalog (no hardcoded English).
- Date/time format follows locale (timezone, calendar).
- Number/currency format.
- RTL layout: Arabic test reverses flexbox direction.
- Pluralization rules (en: 1 / many; vi: 1 / many; ar: 6 forms).

### 8.3 PR Gate
- New string in code không có trong i18n catalog → block.
- New i18n key thiếu translation cho ≥ 1 locale ưu tiên → block (default-to-English fallback warn).
- Pseudo-locale render must không có truncation > 5%.

### 8.4 Schema

```sql
CREATE TABLE i18n_keys (
  key           TEXT PRIMARY KEY,
  default_text  TEXT NOT NULL,
  added_in_pr   INT,
  translations  JSONB DEFAULT '{}',     -- {"vi-VN": "...", "ja-JP": "..."}
  pseudo_loc    TEXT,
  last_used_at  TIMESTAMPTZ
);

CREATE TABLE i18n_coverage (
  locale        TEXT,
  total_keys    INT,
  translated    INT,
  coverage_pct  NUMERIC,
  measured_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (locale, measured_at)
);
```

## 9. UX Heuristic — LLM-as-Judge

### 9.1 Mục tiêu
Hercules biết "test có pass/fail" nhưng không biết "feature có UX tốt không". LLM-as-Judge nhìn screenshot + DOM → đánh giá theo Nielsen 10 heuristics.

### 9.2 10 Nielsen heuristics scored

1. Visibility of system status
2. Match between system and real world
3. User control and freedom
4. Consistency and standards
5. Error prevention
6. Recognition rather than recall
7. Flexibility and efficiency of use
8. Aesthetic and minimalist design
9. Help users recognize, diagnose, and recover from errors
10. Help and documentation

### 9.3 Workflow

```python
async def ux_heuristic_judge(scenario_run: HerculesRun) -> UXReport:
    # Tổng hợp evidence
    screenshots = scenario_run.screenshots()      # array of PNG
    dom_snapshots = scenario_run.dom_states()     # serialized DOM
    user_actions = scenario_run.actions()         # click/type/scroll log
    error_states = scenario_run.errors()
    
    # LLM-as-Judge (Claude Opus, multimodal — read images)
    response = await judge_llm.invoke([
        SystemMessage(NIELSEN_HEURISTIC_RUBRIC),
        HumanMessage([
            *[{"type": "image", "source": s} for s in screenshots],
            {"type": "text", "text": f"DOM at each step: {dom_snapshots}"},
            {"type": "text", "text": f"User actions taken: {user_actions}"},
            {"type": "text", "text": f"Score 0-100 each of 10 heuristics. Cite evidence per finding."}
        ])
    ])
    return parse_ux_report(response)
```

### 9.4 Outcome routing
- Score < 50 trên ≥ 3 heuristics → soft-warn, surface vào sprint planning với evidence.
- Score < 30 trên ≥ 1 heuristic → hard-block + require human override với rationale.
- Score < 20 trên "Error prevention" hoặc "Help users recover" → always hard-block.

### 9.5 Calibration
LLM-as-Judge cũng cần calibrate (xem `Cross-Repo §2`). Brier score tracking:
- Sample 5% report mỗi tuần → human reviews score → feed lại làm training signal cho prompt tuning.

### 9.6 Schema

```sql
CREATE TABLE ux_reports (
  id              UUID PRIMARY KEY,
  scenario_run_id UUID,
  feature_key     TEXT,
  heuristic_scores JSONB,                -- {"visibility": 78, "consistency": 92, ...}
  findings        JSONB,                 -- [{heuristic, severity, evidence_screenshot, rationale}]
  overall_score   NUMERIC,
  outcome         TEXT,                  -- 'pass'|'soft_warn'|'hard_block'
  human_override  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

## 10. Property-Based + Fuzz

### 10.1 Domain logic — Hypothesis (Python) / fast-check (TS)

```python
@given(st.integers(min_value=1, max_value=100), st.integers(min_value=1, max_value=100))
def test_split_payment_invariants(num_payers, total_cents):
    splits = compute_split(num_payers, total_cents)
    assert sum(s.cents for s in splits) == total_cents          # no money lost
    assert all(s.cents >= 1 for s in splits)                    # no zero share
    assert max(s.cents for s in splits) - min(s.cents for s in splits) <= 1  # balanced
```

### 10.2 API fuzz

- **schemathesis** đọc OpenAPI → gen random valid + boundary + malformed requests.
- Detect 5xx, schema-violation responses, timeout.
- Auto-create issue khi tìm bug, gán cho Engineer agent.

### 10.3 LLM-driven adversarial prompt fuzz (cho LLM endpoint)

Riêng API expose LLM (chat, autocomplete): chạy adversarial prompt corpus (jailbreak, prompt injection) → assert refuse correctly.

### 10.4 Auto-add to test_author corpus

Khi fuzz tìm bug → reproducer được add vĩnh viễn vào regression suite (regression_tracker module).

## 11. Synthetic User Persona Simulation

### 11.1 Reuse Greenfield personas

`Greenfield-Bootstrap-Design.md §3` đã tạo persona cho project mới. Khi project enter dev, personas trở thành **synthetic test users**:

```yaml
persona:
  name: "Chị Lan, BQT Trưởng tòa Ngọc Xuân"
  age: 45
  tech_savvy: low
  primary_goal: "Phê duyệt yêu cầu sửa chữa của cư dân nhanh"
  primary_device: "iPad cũ, mạng wifi yếu"
  language: "vi-VN"
  habits:
    - "Mở app 2 lần/ngày, sáng và tối"
    - "Cuộn nhanh, ít đọc"
    - "Chụp màn hình khi không hiểu"
```

### 11.2 Persona-driven test generation

- Test author agent: "Generate 5 scenarios for persona X using product spec Y."
- Output: NL scenarios cho Hercules, weighted theo `habits` + `tech_savvy`.
- Ví dụ: chị Lan tech_savvy=low → scenario có "click wrong button first, find back button" (recovery flow).

### 11.3 Realistic data

- Persona có dataset đi kèm: tên VN, địa chỉ VN, số điện thoại VN format, building data realistic size (50-300 unit), không phải Lorem Ipsum.
- Generated bởi `test_author` từ persona profile.

### 11.4 Coverage signal

Sprint review: % scenario covering each persona. Nếu một persona < 30% coverage → gen thêm scenarios.

## 12. Performance + Chaos — Hardening

### 12.1 Performance baseline regression

```sql
CREATE TABLE perf_baselines (
  endpoint        TEXT,
  method          TEXT,
  p50_ms          NUMERIC,
  p95_ms          NUMERIC,
  p99_ms          NUMERIC,
  recorded_at     TIMESTAMPTZ,
  train_tag       TEXT,
  PRIMARY KEY (endpoint, method, train_tag)
);
```

Compare per PR/Train. Hard-block nếu p95 tăng > 30% so với baseline trước. Soft-warn nếu > 15%.

### 12.2 Chaos game day cron

- Weekly: chọn random 1 service trong stag, inject failure (kill pod, network partition, DB latency 2s, 50% error rate).
- Verify: app degrade gracefully (không full crash), recovery < 5 min sau restore.
- Library scenarios trong `chaos_engineer.py`:
  - Network: drop packet, latency spike, DNS fail.
  - DB: connection pool exhaust, slow query, replica lag.
  - LLM provider: 500 error, timeout, rate-limit.
  - Memory: OOM kill.
  - Time: clock drift.

## 13. Security Functional Test

### 13.1 Beyond dependency CVE

Hercules + custom assertions:
- **Auth bypass**: try access endpoint X without token → expect 401.
- **IDOR**: tenant A's user try GET /resources/{tenant-B-resource-id} → expect 404 (not 403, để không leak existence).
- **CSRF**: request without proper token → expect 403.
- **XSS**: input `<script>alert(1)</script>` vào mọi text field → render as text.
- **SQL injection**: `' OR 1=1 --` vào search → no leak.
- **Path traversal**: `../../etc/passwd` vào filename param → reject.

Auto-gen test cases per endpoint từ OpenAPI + threat model.

### 13.2 Bridge vào security_scanner agent

Result feed vào cùng `security_findings` table (Auto-Ops §5) — unified queue.

## 14. Production Synthetic Probe

### 14.1 Hercules cron trên prod

- Mỗi 5 phút: chạy 1 critical scenario trên prod (light, không gây load).
- Mỗi 1h: chạy full critical suite (5-10 scenarios).
- Mỗi 24h: full multi-locale + multi-browser sweep.

### 14.2 Probe scenario design

- Read-only first preference (login + view dashboard).
- Write-then-cleanup (create test entity → verify → delete).
- Use dedicated `synthetic_probe@paperclip.test` user, isolated tenant `__probe__`.

### 14.3 Alerting

- Probe fail 1 lần → soft-warn, log.
- Probe fail 2 consecutive → hard alert, on-call agent (xem `Auto-Ops §4`).
- Probe fail 3 consecutive → P1 incident, auto-rollback last Train (qua `Git-Branch-Tag §4.3`).

### 14.4 Schema

```sql
CREATE TABLE synthetic_probes (
  id            UUID PRIMARY KEY,
  scenario      TEXT,
  env           TEXT,
  ran_at        TIMESTAMPTZ DEFAULT now(),
  passed        BOOL,
  duration_s    NUMERIC,
  failure_step  TEXT,
  trace_url     TEXT,
  alert_emitted BOOL DEFAULT FALSE
);

CREATE INDEX idx_probe_recent ON synthetic_probes(scenario, ran_at DESC);
```

## 15. Test orchestration — Combined pipeline

```
PR opened
  ├─ Tier 1 (every PR, < 5 min)
  │  ├─ Unit tests (pytest)
  │  ├─ Integration tests (API)
  │  ├─ Contract diff
  │  ├─ Hercules smoke (Chromium, en-US, laptop viewport, 3 happy-paths)
  │  ├─ Visual regression (smoke pages only)
  │  ├─ a11y critical only
  │  └─ Security functional smoke
  │
  ├─ Tier 2 (PR ready-for-review, < 20 min)
  │  ├─ Hercules full suite (Chromium + Firefox + WebKit if criticality)
  │  ├─ Cross-device viewport matrix
  │  ├─ Visual regression full
  │  ├─ a11y full WCAG AA
  │  ├─ Performance baseline check
  │  ├─ Property-based + API fuzz
  │  ├─ UX heuristic LLM-as-Judge
  │  ├─ i18n locale matrix (en-US + vi-VN + qps-ploc)
  │  └─ Mobile native (Appium) if mobile changed
  │
  └─ Train build (post-merge, < 60 min)
     ├─ Cross-repo E2E suite
     ├─ Persona-driven scenarios (top 3 personas)
     ├─ Chaos light (1 service degraded)
     ├─ BrowserStack legacy browser pass
     └─ Full mobile native (iOS + Android simulator farm)

Train promote stag → live
  ├─ Production synthetic probe activated
  └─ 7-day soak with continuous probe
```

## 16. Schema overview (consolidated)

Tổng cộng doc này thêm 11 table:
- `visual_baselines`, `visual_diffs`
- `a11y_violations`
- `browser_test_runs`
- `mobile_test_runs`
- `i18n_keys`, `i18n_coverage`
- `ux_reports`
- `perf_baselines`
- `synthetic_probes`
- `mobile_test_runs` (đã liệt kê)

## 17. Manual Test Case Fallback — Human-Executable Layer

> **Suggest từ user (2026-04-29):** Test case nào automation không cover được → mark là *human-manual-execute*. Agent vẫn phải chuẩn bị đầy đủ kịch bản, data test, story người làm, format report — chỉ "tay" thực thi do human đảm nhận. Đảm bảo zero gap, không bỏ sót dimension nào dù tool chưa kham được.

### 17.1 Khi nào TC là manual

Test author agent classify mỗi TC theo decision tree:

```
TC scope check:
  ├─ Pure UI rendering / interaction? → automatable (Hercules / visual / a11y)
  ├─ API logic? → automatable (integration / fuzz)
  ├─ Cross-browser legacy (Edge < 18, Safari iOS 14)? → manual nếu BrowserStack quota cạn
  ├─ Subjective UX taste ("feel professional"?) → MANUAL
  ├─ Cultural / brand fit (Vietnamese tone-of-voice)? → MANUAL
  ├─ Real-device-specific (Touch ID, Face ID, NFC, Bluetooth)? → MANUAL on physical device
  ├─ Third-party integration với sandbox không support? → MANUAL
  ├─ Exploratory / serendipity (tester improv) → MANUAL by design
  ├─ Compliance witness (PDPL audit, có chữ ký người chứng kiến) → MANUAL
  ├─ Customer-data-realistic (cần data từ tenant thật, không synth được) → MANUAL với ngọc xuân-style
  └─ Default → automatable, gen Hercules scenario
```

Decision lưu vào `test_cases.execution_mode` enum: `auto_hercules` | `auto_appium` | `auto_unit` | `auto_integration` | `auto_fuzz` | `manual_human` | `manual_witness` | `hybrid` (auto + human review screenshot).

### 17.2 TC kit cho manual — agent phải chuẩn bị đầy đủ

**Định luật:** "Human chỉ tay không, agent prepare 100% còn lại". Khi TC = `manual_*`, agent phải sinh ra bundle:

```yaml
# Generated by test_author agent → stored in test_cases.manual_kit JSONB
title: "Đăng nhập Face ID lần đầu trên iPhone 15 thật"
feature_key: split-payment
priority: P1
estimated_minutes: 8

prerequisite:
  - "iPhone 15 (real, KHÔNG simulator)"
  - "iOS 17.4+"
  - "Tài khoản test: alice+manualtc-2026-04@paperclip.test (pw đính kèm)"
  - "Tenant: __manual_test_tenant__"
  - "Build mobile: TestFlight Internal track v3.7.2 build 412"

test_data:
  user:
    email: alice+manualtc-2026-04@paperclip.test
    password: <vault://manual-tc-creds/alice>
  building_seed_id: "BLD-MANUAL-001"
  payment_card: "4242 4242 4242 4242 (test card)"

story_for_tester:
  context: |
    Bạn là chị Lan, BQT trưởng tòa Ngọc Xuân, lần đầu cài app trên iPhone mới.
    Bạn vừa mua iPhone 15, đã setup Face ID cho điện thoại nhưng chưa từng
    bật cho app này. Hôm nay bạn đăng nhập app lần đầu trên thiết bị này.
  goal: "Đăng nhập app + bật Face ID + verify lần sau mở app không cần nhập password"

steps:
  - id: 1
    action: "Mở app Paperclip Resident từ Home Screen"
    expect: "Splash screen hiển thị logo, fade vào màn hình Login"
    capture: "screenshot khi splash"
  - id: 2
    action: "Nhập email + password (xem prereq)"
    expect: "Button 'Đăng nhập' chuyển sang active"
  - id: 3
    action: "Tap 'Đăng nhập'"
    expect: "Modal hỏi 'Bật Face ID cho lần sau?' xuất hiện sau < 2s"
    capture: "screenshot modal"
  - id: 4
    action: "Tap 'Bật'"
    expect: "iOS Face ID prompt xuất hiện (system UI)"
  - id: 5
    action: "Nhìn vào điện thoại, hoàn tất Face ID enrollment"
    expect: "App vào Home, hiển thị tên 'Chị Lan' ở header"
  - id: 6
    action: "Force-quit app (swipe up + drag)"
    expect: "App đóng"
  - id: 7
    action: "Mở lại app từ Home Screen"
    expect: "Splash → Face ID prompt (KHÔNG hỏi password) → vào Home"
    capture: "video step 6→7"

negative_steps_to_try:
  - "Khi Face ID prompt, che mặt → expect fallback to password sau 2 thử"
  - "Disable Face ID trong Settings → mở app → expect rơi về password login"

report_template:
  required:
    - field: passed
      type: enum [pass, fail, blocked, skip]
    - field: ios_version
      type: text
      example: "17.4.1"
    - field: device_model
      type: text
      example: "iPhone 15 Pro Max"
    - field: actual_observed_at_step_3_modal_latency_seconds
      type: number
    - field: face_id_enrollment_smooth
      type: enum [yes, partially, no]
    - field: any_unexpected_modal_or_alert
      type: text_or_none
  uploads:
    - "screenshot step 1 splash"
    - "screenshot step 3 modal"
    - "video step 6→7"
  optional:
    - field: subjective_ux_rating_1_5
      type: number
    - field: notes
      type: long_text

acceptance_criteria_for_pass:
  - "Steps 1-7 khớp 'expect'"
  - "Latency step 3 < 2s"
  - "Face ID enrollment 'yes' hoặc 'partially' với note"
  - "Không có unexpected modal"

failure_routing:
  - if_step_3_latency_>_2s: "P2 perf bug, tag mobile-ios"
  - if_step_5_face_id_fail: "P1, tag platform-ios + auth"
  - if_unexpected_modal: "human escalate, do not auto-classify"
```

### 17.3 Schema

```sql
CREATE TABLE test_cases (
  id              UUID PRIMARY KEY,
  feature_key     TEXT NOT NULL,
  title           TEXT NOT NULL,
  priority        TEXT NOT NULL,         -- 'P0'|'P1'|'P2'|'P3'
  execution_mode  TEXT NOT NULL,         -- enum xem §17.1
  authored_by     UUID,                   -- agent or human
  scope_tags      TEXT[],                 -- ['mobile-ios','face-id','first-run']
  estimated_minutes INT,
  
  -- For automation modes:
  scenario_ref    TEXT,                   -- path/to/hercules.yaml or pytest::test_xxx
  
  -- For manual_* modes:
  manual_kit      JSONB,                  -- toàn bộ §17.2 bundle
  
  -- Lifecycle
  state           TEXT NOT NULL,         -- 'draft'|'review'|'active'|'deprecated'
  created_at      TIMESTAMPTZ DEFAULT now(),
  last_reviewed_at TIMESTAMPTZ,
  retired_at      TIMESTAMPTZ
);

CREATE INDEX idx_tc_feature ON test_cases(feature_key);
CREATE INDEX idx_tc_mode ON test_cases(execution_mode) WHERE state = 'active';

CREATE TABLE manual_test_executions (
  id              UUID PRIMARY KEY,
  test_case_id    UUID REFERENCES test_cases(id),
  train_tag       TEXT,                   -- gắn với release train cụ thể
  assignee        UUID REFERENCES users(id),
  assigned_at     TIMESTAMPTZ,
  due_at          TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  submitted_at    TIMESTAMPTZ,
  outcome         TEXT,                   -- 'pass'|'fail'|'blocked'|'skip'
  report          JSONB,                  -- match report_template required+optional
  uploads         JSONB DEFAULT '[]',     -- [{filename, s3_url, kind}]
  reviewer        UUID,                    -- 2nd human can verify
  reviewed_at     TIMESTAMPTZ,
  flake_signal    BOOL DEFAULT FALSE      -- nếu cùng TC fail intermittent
);

CREATE TABLE tester_pool (
  user_id         UUID PRIMARY KEY REFERENCES users(id),
  capacity_minutes_per_day INT DEFAULT 240,
  skills          TEXT[],                  -- ['mobile-ios','accessibility','vi-VN']
  device_access   JSONB,                   -- {"iPhone-15-real": true, "Samsung-S22": true}
  active          BOOL DEFAULT TRUE
);
```

### 17.4 Manual TC orchestrator (LangGraph)

```
classify_tc_mode (test_author agent → enum)
  │
  ├─ if auto_*: gen scenario, attach to PR pipeline → §15 tier flow
  │
  └─ if manual_*: 
       gen full kit (§17.2)
       │
       ├─ assign_to_pool → pick tester from tester_pool
       │     (skills match + device_access match + capacity available)
       │
       ├─ create_approval_item kind='manual_tc_assignment'
       │     (xuất hiện trong tester's queue + Slack ping)
       │
       ├─ wait_for_submission (with SLA, default 24h cho P1, 72h cho P2)
       │
       ├─ if SLA breach: re-route to backup tester, notify ops
       │
       ├─ on_submit:
       │     ├─ validate report against report_template required fields
       │     ├─ if missing field: bounce back with checklist
       │     ├─ if has uploads: scan for PII before storing (Multi-Tenant compliance)
       │     ├─ apply failure_routing rules → auto-create issue if needed
       │     └─ update test_cases.last_executed_at + outcome
       │
       └─ feed_into_train_gate: outcome blocks promote nếu P0/P1 fail
```

### 17.5 Manual TC quality control

Manual TC chất lượng cao đòi hỏi tester nghiêm túc, không tick-bừa:

- **Spot check 5%**: 5% manual execution random được 2nd reviewer xem lại + so screenshot. Disagreement rate > 10% → flag tester for retraining.
- **Witness mode**: P0 manual TC với compliance impact (ví dụ DSR proof) → require 2 testers cùng ký, screen-record toàn bộ.
- **Flake detection**: cùng TC bởi 2 tester khác nhau ra outcome khác → tag `flake_signal=true`, gen automation alternative.
- **Tester score**: track đúng-sai theo time, rate-up tester reliable, route TC quan trọng cho họ.

### 17.6 Cost-budget

Manual TC đắt (~$5-30 per execution tùy độ phức tạp). Budget rule:

| Train criticality | Manual TC budget |
|---|---|
| Hotfix urgent | Max 5 P1 manual TC |
| Standard sprint | Max 30 manual TC across all P |
| Major release | Up to 100 manual TC, scheduled 1 tuần trước GA |

Excess → either accept skipped (with tag), or upgrade automation (test_author tries again to convert manual → auto-hercules with screenshot LLM-as-Judge).

### 17.7 Kết quả: zero coverage gap

Sau §17, mọi dimension trong matrix (§2) đều có coverage:
- Tool kham được → automation.
- Tool không kham được → manual với full kit.
- Không có test bị skip vì "không có cách test".

## 18. Test Case Browser — Per-Feature Visibility UI

> **Suggest từ user (2026-04-29):** Cần xem được toàn bộ test case do QA tạo ra cho 1 feature trên Paperclip — dù automation hay manual. Lý do: human muốn audit coverage, hiểu agent đang test gì, xác minh chất lượng QA agent's output.

### 18.1 Mục tiêu UI

Approval Center có thêm tab **"Quality"** bên cạnh existing tabs (Active Features, Active Trains, Hotfix Queue). Tab này show:

1. Feature picker → chọn `feature_key` (split-payment).
2. **Coverage Heatmap**: 16-dimension × execution_mode matrix với cell = số TC.
3. **Test Case List**: bảng phẳng, filterable, sortable.
4. **Per-TC drilldown**: click vào TC → show full detail (manual_kit hoặc automation scenario), execution history, recent runs với outcome.
5. **Coverage gauge**: % dimension có ≥ 1 active TC. Target ≥ 90%.

### 18.2 List view — columns

| Col | Source |
|---|---|
| TC ID | `test_cases.id` (short hash) |
| Title | `test_cases.title` |
| Priority | P0..P3 |
| Mode | `auto_hercules` / `auto_appium` / `manual_human` ... với icon |
| Scope tags | chips |
| Last run outcome | latest from manual_test_executions / browser_test_runs / etc |
| Last run train | train tag |
| Owner | author agent or human |
| Actions | View · Run now · Mark deprecated · Convert mode |

### 18.3 Filters

- By execution_mode (multi-select).
- By outcome trend (always-pass / sometimes-fail / always-fail / never-run).
- By dimension covered (visual / a11y / cross-browser / mobile / i18n / ux-heuristic / security / etc).
- By age (TC > 90 ngày chưa chạy → flag stale).
- By assignee (cho manual queue view).

### 18.4 Coverage Heatmap

```
              auto_hercules  auto_appium  auto_unit  auto_int  manual_human  manual_witness
visual          ✓ 12          –            –         –         ✓ 2           –
a11y            ✓ 8           ✓ 3          –         –         ✓ 1           –
cross_browser   ✓ 6           –            –         –         ✓ 4           –
cross_device    ✓ 9           –            –         –         –             –
mobile_native   –             ✓ 14         –         –         ✓ 6           –
i18n            ✓ 4           –            ✓ 2       –         ✓ 1           –
ux_heuristic    ✓ 3 (LLM)     –            –         –         ✓ 8           –
security        ✓ 5           –            ✓ 4       ✓ 6       –             ✓ 1
performance     ✓ 2           ✓ 1          ✓ 3       ✓ 2       –             –
chaos           –             –            –         ✓ 4       –             –
prod_synthetic  ✓ 5           ✓ 2          –         –         –             –
unit_logic      –             –            ✓ 87      –         –             –
api_integration –             –            –         ✓ 23      –             –
contract_diff   –             –            –         ✓ 7       –             –
e2e_happy       ✓ 11          ✓ 4          –         –         ✓ 3           –
e2e_negative    ✓ 6           ✓ 2          –         ✓ 8       ✓ 5           –
```

Cell highlight đỏ nếu = 0 cho dimension critical với feature đó.

### 18.5 Per-TC drilldown panel

Tab strip:
- **Detail**: title, priority, mode, manual_kit hoặc scenario_ref source, prerequisite, expected.
- **History**: bảng mọi execution với train tag, outcome, duration, evidence link.
- **Evidence**: lazy-load screenshots, videos, axe reports, Hercules traces.
- **Conversation**: comment thread giữa tester + reviewer + Engineer agent (khi failure routing tạo issue).
- **Audit**: ai tạo, ai review, ai retire, audit_log entries.

### 18.6 "Run now" semantics

- Auto TC: trigger 1 ad-hoc run, output về hist.
- Manual TC: enqueue 1 manual_test_execution với assignee picker.

### 18.7 API

REST:
- `GET /api/v1/features/{key}/test-cases` — list với filter query.
- `GET /api/v1/test-cases/{id}` — detail + execution history.
- `POST /api/v1/test-cases/{id}/runs` — kick ad-hoc run.
- `GET /api/v1/features/{key}/coverage` — heatmap data.

GraphQL alternative cho Obsidian-like exploration: query nested manual_kit → step → expected.

### 18.8 Public-share view

Operator (anh) có thể "share read-only link" của 1 feature TC list cho stakeholder external (ví dụ tenant admin enterprise muốn audit "tôi muốn xem các bạn test gì cho phần billing"). Read-only, signed URL, expires 7d, audit log entry.

### 18.9 Tester mobile UX

Tester pool members (manual executor) thường ở mobile:
- Tab "My Queue" trong mobile app: liệt kê assigned manual TC với due time.
- Tap TC → step-by-step screen với checkbox per step + camera button per `capture` requirement.
- Submit form ngay trên mobile, optionally voice-to-text cho notes.
- Offline: kit cached, sync khi online.

### 18.10 Schema — UI views

```sql
-- Materialized view recompute mỗi 5 phút
CREATE MATERIALIZED VIEW feature_coverage_heatmap AS
SELECT
  tc.feature_key,
  d.dimension_name,
  tc.execution_mode,
  COUNT(*) FILTER (WHERE tc.state = 'active') AS active_count,
  COUNT(*) FILTER (WHERE
    EXISTS (SELECT 1 FROM execution_history eh
            WHERE eh.test_case_id = tc.id AND eh.outcome = 'pass'
            AND eh.ran_at > now() - interval '14 days')
  ) AS recently_passing
FROM test_cases tc
CROSS JOIN LATERAL unnest(tc.scope_tags) d(dimension_name)
GROUP BY tc.feature_key, d.dimension_name, tc.execution_mode;

CREATE UNIQUE INDEX ON feature_coverage_heatmap (feature_key, dimension_name, execution_mode);
```

### 18.11 Quality dashboard at portfolio level

Beyond per-feature, an owner-level dashboard:
- Top 10 feature có coverage thấp nhất.
- Top 10 TC failing trong tuần.
- Manual test budget burn rate.
- Tester pool utilization.
- Mode shift trend (manual → auto conversion success rate).

## 19. Implementation roadmap

| Phase | Effort | Output |
|---|---|---|
| Sprint 1 | 4d | Visual regression (Playwright snapshot + S3 + diff UI) |
| Sprint 2 | 4d | a11y pipeline (axe-core integrate vào Hercules + WCAG mapping) |
| Sprint 3 | 3d | Cross-browser matrix (Playwright multi-engine + criticality routing) |
| Sprint 4 | 3d | Cross-device viewport matrix |
| Sprint 5 | 5d | Mobile native bridge (Appium adapter + simulator farm) |
| Sprint 6 | 4d | i18n scaffolding (catalog + pseudo-locale + RTL) |
| Sprint 7 | 5d | UX heuristic LLM-as-Judge + calibration loop |
| Sprint 8 | 3d | Property-based + schemathesis + adversarial fuzz |
| Sprint 9 | 4d | Persona-driven scenarios (reuse Greenfield personas) |
| Sprint 10 | 3d | Performance baseline regression |
| Sprint 11 | 3d | Chaos game day cron + scenario library expansion |
| Sprint 12 | 3d | Security functional (auth bypass, IDOR, CSRF, XSS, SQLi, traversal) |
| Sprint 13 | 4d | Production synthetic probe + alerting + auto-rollback |
| Sprint 14 | 2d | UX dashboard (test runs, coverage heatmap, regression history) |
| Sprint 15 | 4d | Manual TC orchestrator: classifier + kit generator + tester pool + assignment + report validator |
| Sprint 16 | 3d | Tester mobile UX (My Queue + step screen + camera + offline sync) |
| Sprint 17 | 4d | Test Case Browser UI (Quality tab in Approval Center: list + heatmap + drilldown + Run Now) |
| Sprint 18 | 2d | Public read-only share link + audit log entries |

Total: ~63 ngày eng work. Có thể parallel nhiều Sprint với 2-3 dev → ~8-10 tuần wallclock.

## 20. Trả lời lại câu hỏi gốc

### "Test được như user thực thụ không?"

Sau khi implement doc này:
- ✅ Functional happy path cross-browser/device/locale.
- ✅ Visual sai sót (button cắt, contrast kém) — visual regression + a11y bắt được.
- ✅ Mobile native (iOS Sim + Android Emu).
- ✅ Persona-driven scenarios (chị Lan tech-low simulated với realistic data + habits).
- ✅ UX heuristic judgement automated (Nielsen 10 — LLM-as-Judge).
- ✅ Production synthetic probe 24/7 → bắt regression sau deploy.
- ⚠️ **Vẫn còn limit**: exploratory testing thuần (như tester có cảm hứng "thử cái này coi sao") — đây vẫn là human work, vì cần serendipity. Paperclip có persona-driven coverage rộng nhưng không thay thế được.
- ⚠️ **Subjective brand fit / taste**: "feature này có cảm giác Apple-quality không" — vẫn human gate. Đây đúng tinh thần "human là gate".

### "Đánh giá chất lượng sản phẩm" — có không?

Có, ở 3 cấp:
1. **Hard metrics** — pass/fail tests, coverage %, p95 latency, crash rate, a11y violation count.
2. **Soft metrics** — UX heuristic score (10 Nielsen), persona scenario coverage, visual diff %.
3. **Production-derived** — synthetic probe success rate, real user crash, App Store rating delta.

Composite "product quality score" (0-100) auto-tính per Train, surface lên Approval Center khi promote. Train thấp score → require explicit human override.

### "Dừng ở đâu?" — sau §17 (manual fallback) thì còn dừng ở đâu nữa?

Sau implement đầy đủ:
- **Trong scope tự động (auto)**: 16/16 dimension đạt ≥ 8/10.
- **Trong scope manual fallback (human-executed, agent-prepared)**: zero dimension bị bỏ sót — kể cả Touch ID, brand-fit, exploratory, cultural — đều có TC manual với full kit.
- **Vẫn ngoài scope kể cả manual TC**:
  - Strategic UX direction (quyết định "nên redesign onboarding hay không") — đây là **thiết kế**, không phải test.
  - Customer interview qualitative ("vì sao chị Lan ghét feature X") — research, không phải QA.
  - Real customer beta program (TestFlight ngoài internal pool) — đó là user research, không phải acceptance.

→ Đây đúng nghĩa "human là gate cho **decision**, agent automate phần **execution và preparation đo được**".

## 21. Score impact

| Dimension | Trước | Sau (auto only) | Sau (auto + manual fallback §17) |
|---|---|---|---|
| Aggregate testing capability | 4.6/10 | 8.4/10 | **9.2/10** |
| Subjective quality assessment | 2/10 | 7/10 | **9/10** (manual closes UX/taste gap) |
| Production reliability detection | 3/10 | 9/10 | **9/10** |
| Coverage transparency (audit-ability) | 3/10 | 5/10 | **9/10** (Test Case Browser §18) |
| Zero-skip dimension coverage | n/a | partial | **yes** (everything has TC, even if manual) |

Cộng vào aggregate Paperclip overall: 8.7 → **9.0/10**.

**Quan trọng nhất:** sau §17 + §18, không còn dimension nào "không test được". Tool gap → manual fallback. Operator (anh) thấy được toàn bộ TC + ai làm + outcome + evidence. Đây đúng tinh thần "human là gate cho phần subjective + tool gap, agent prepare 100% còn lại".

## 22. Cross-doc updates — DONE (2026-04-29)

- ✅ `Auto-Ops §3.3` Test Strategy 3-Layer → mở rộng thành 4-Layer (Unit / Integration / E2E / **Quality** = visual+a11y+UX+manual TC).
- ✅ `Mobile Distribution §10` add link đến §7 mobile native bridge (Appium iOS Sim + Android Emu).
- ✅ `Per-Tenant Rollout §2.5` auto-pause trigger thêm production synthetic probe fail.
- ✅ `Git-Branch-Tag §11` PR Gate rules: thêm Tier 1/Tier 2 quality checks + manual TC blocker.
- ✅ `Greenfield-Bootstrap §3.3` personas → marked là "test fixture source" cho QA dept (reused trong Synthetic persona simulation §11).
- `00-Master §6` core tables: thêm 11 table mới của doc này.
