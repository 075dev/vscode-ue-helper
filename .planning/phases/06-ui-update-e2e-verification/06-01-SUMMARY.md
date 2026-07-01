---
phase: 06-ui-update-e2e-verification
plan: 01
subsystem: ui
tags:
  - localization
  - control-panel
  - i18n
  - restart-notice
requires:
  - LOC-02-06
  - LOC-02-07
provides:
  - Updated control panel localization mode selector labels (bilingual Chinese/English)
  - Restart notification bar when localization mode changes
affects:
  - src/ui/controlPanelMessages.ts
  - src/ui/controlPanel.html.ts
  - src/ui/controlPanel.ts
  - src/i18n/locales/en.json
  - src/i18n/locales/zh.json
tech-stack:
  added: []
  patterns:
    - SaveResult includes localizationModeChanged flag for conditional UI responses
key-files:
  created: []
  modified:
    - src/ui/controlPanelMessages.ts
    - src/ui/controlPanel.html.ts
    - src/ui/controlPanel.ts
    - src/i18n/locales/en.json
    - src/i18n/locales/zh.json
decisions:
  - Used bilingual labels (Chinese/English) for mode selector dropdown per D-01
  - Used amber/warning color scheme for restart notice bar to match VS Code warning conventions
  - localizationModeChanged flag added to SaveResult to avoid modifying the message protocol type
metrics:
  duration: 8m
  completed: "2026-07-01"
status: complete
---

# Phase 6 Plan 1: Update control panel labels and add restart notice bar

**Updated control panel Proxy Tab localization mode labels to bilingual Chinese/English and added an amber restart-notice bar that appears when the user saves a localization mode change.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-01T02:41:00Z
- **Completed:** 2026-07-01T02:44:36Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- PROXY_SELECTS.localizationMode dropdown shows "中英双语 / Bilingual" (append) and "仅中文 / Chinese Only" (zh-only)
- Status tab localization row correctly maps zh-only to "仅中文" and append to "中英双语"
- No 'override' string remains in control panel source files
- i18n keys `panel.notice.restartProxy` and `panel.notice.restartProxyTitle` added to both en.json and zh.json
- Yellow restart-notice bar with warning icon, message text, and close button appears when localizationMode changes
- Close button hides the notice bar
- SaveResult interface extended with optional `localizationModeChanged` field
- batchSave detects localizationMode changes and passes the flag through the response

## Task Commits

Each task was committed atomically:

1. **Task 1: Update PROXY_SELECTS labels and status display** - `03f8f0a` (feat)
2. **Task 2: Add restart notice bar, i18n keys, and configChanges wiring** - `1dfc134` (feat)

## Files Modified

- `src/ui/controlPanelMessages.ts` - Updated localizationMode labels to bilingual; added `localizationModeChanged` to SaveResult interface
- `src/ui/controlPanel.html.ts` - Fixed status display ternary; added warning-notice CSS, HTML bar, close button handler, and saveResult notice logic
- `src/ui/controlPanel.ts` - Added localizationMode detection in batchSave, passed through return value
- `src/i18n/locales/en.json` - Added `panel.notice.restartProxy` and `panel.notice.restartProxyTitle` keys
- `src/i18n/locales/zh.json` - Added `panel.notice.restartProxy` and `panel.notice.restartProxyTitle` keys

## Decisions Made

- Used bilingual labels (Chinese/English) for dropdown options per D-01 to serve both Chinese and international users
- Used amber/warning color scheme (#856404 background) for the restart notice bar, consistent with VS Code warning conventions
- Added `localizationModeChanged` as an optional field on `SaveResult` rather than creating a new message type, minimizing protocol surface change

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

| Check | Result |
|-------|--------|
| Old 'override' value removed from controlPanelMessages.ts | Pass (0 matches) |
| Old 'override' value removed from controlPanel.html.ts | Pass (0 matches) |
| Bilingual labels present in controlPanelMessages.ts | Pass |
| Status display maps zh-only to "仅中文" | Pass |
| i18n keys exist in en.json | Pass |
| i18n keys exist in zh.json | Pass |
| proxy-restart-notice HTML present | Pass |
| localizationModeChanged in SaveResult interface | Pass |
| localizationModeChanged detection in batchSave | Pass |
| `npm run build` | Zero errors |

## Issues Encountered

None.

## Self-Check: PASSED

All files exist, all commits found, frontmatter includes `status: complete`.

## Next Phase Readiness

- Control panel labels and restart notification complete
- Ready for E2E verification in the next plan (06-02 already complete)
