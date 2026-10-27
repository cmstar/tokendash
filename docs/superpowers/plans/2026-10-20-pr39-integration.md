# PR #39 integration plan

## Scope

Use PR #39 as the single integration candidate. Its application sources match
#38, and its final commit restores upstream release destinations. Close #38 as
superseded rather than merging overlapping branches twice.

Keep Linux tray support, cross-agent statistics, model pricing/currency display,
Pi usage estimates, transcript analysis, and the indexed live-refresh fix. Keep
the existing visibility/power-aware refresh behavior and cached quota polling.
Do not merge to main, publish a release, or change version/build numbers here.

## Required corrections

- Retain documented Node 20 support (20.10+ for JSON import attributes): resolve native SQLite only when available,
  otherwise query the existing sqlite3 CLI using arguments, never shell SQL.
  Missing SQLite must not prevent Claude/Codex or the server from starting.
- Preserve legacy OpenCode message session IDs when associating transcripts and
  usage. A single fixture session must remain one session with identical token
  and cost totals in all-time and current-day results.
- Ignore incomplete/malformed Pi JSONL records and invalid timestamps while
  preserving valid messages. One active file must not break all-agent analysis.
- Select a compatible Node runtime for Linux, skipping old system installations;
  handle explicit overrides consistently. Escape autostart executable paths.
- Preserve main-based development/release policy: remove the unrelated develop
  branch mandate added by the contribution. The unified deploy flow and upstream
  Sparkle URLs remain the release contract.

## Verification

- Add targeted regressions first and observe failure before fixing.
- Run typecheck, unit tests, build and bundled CLI startup on Node 20.10, current 20, 22 and 24.
- Run frontend Playwright tests, Swift tests and Swift release build.
- Run Rust pure-logic tests and formatting locally where available; use Linux CI
  for full fmt/clippy/test and deb/AppImage bundle validation.
- Add Node-version matrix and macOS verification to CI so these boundaries stay
  covered. Do not claim Linux GUI manual validation from a macOS host.

## Communication

Comment on both PRs with the identified problems, fixes/handling policy, and
verification evidence. Correct the claim that Swift files were untouched: this
PR changes BadgeUpdater's live-refresh behavior and corresponding tests.
