# Kudos Digest Execution Plan

## Goal
Finish Kudos Digest core feature set: scheduled weekly digest via Slack Workflows API (no cron), full edit/delete kudos, and App Home refresh after mutations.

## Decisions
- Edit/delete allowed for kudos author AND workspace admins.
- One workspace-wide scheduled workflow for the weekly digest.
- Admin check: use `client.users.info({ user })` and allow when `user.is_admin` is true.

## Current State
- App scaffold is in place and tests pass (`pnpm build`, `pnpm test`).
- `/kudos` creates kudos, `/kudos-export` returns CSV, Settings modal saves schedule, and `app_home_opened` renders recent kudos.
- Database already has `updateKudos`/`deleteKudos` and `getWeeklyKudos`.
- AI service handles simple / formatted / creative digests.

## In Scope
- Workflows trigger integration for digest scheduling
- Edit modal flow and update handler
- Delete flow and confirmation handling
- Home view refresh after mutations
- Google Docs / Google Sheets export (copy/paste-ready)
- Tests and docs

## Milestones

### 1. Workflows Scheduled Digest
- Update `manifest.yml` to add `workflow:write` scope.
- In `src/listeners/index.ts` and `src/index.ts`, add workflow trigger setup when Settings are saved.
- Persist trigger ID so it can be updated without duplicates.
- Keep manual trigger fallback for development.
- QA: trigger registered, scheduled, posts to configured channel, updates when schedule changes.

### 2. Edit/Delete Kudos
- Implement `edit_kudos_<id>` action: open modal, validate, call `db.updateKudos`, refresh home.
- Implement `delete_kudos_<id>` action: confirm, call `db.deleteKudos`, refresh home.
- Allow the kudos author OR workspace admins (is_admin=true on user object) to edit/delete; others get ephemeral error.
- Handle missing/bad IDs gracefully.

### 3. App Home Refresh
- Extract home view builder into reusable helper.
- Call `client.views.publish` after create/edit/delete and after sending/confirming digest.
- Use async helper that returns fresh data.

### 4. Google Export (Copy/Paste)
- Add `/kudos-export-google` slash command (or extend `/kudos-export` with format option).
- Accept date range args (`YYYY-MM-DD YYYY-MM-DD`).
- Fetch kudos via `db.getKudosByDateRange`.
- Group by recipient and format:
  - Header: `Kudos from <start> to <end>`
  - For each recipient:
    - `Title: Kudos to <displayName>`
    - `"<reason>" :emoji:`
    - `from <fromName>`
    - blank line between entries
- Send as ephemeral message with copy guidance.
- Also send Google Sheets-ready CSV block.
- Include note: copy into Google Docs/Sheets.

### 5. Tests and Polish
- Add tests for new handlers and helpers.
- Run `pnpm test`, `pnpm build`, `pnpm lint`.
- Update README to show workflow setup and edit/delete behavior.

## Acceptance Criteria
- Workflows API trigger installs and updates from Settings.
- `/kudos`, edit, and delete all keep App Home consistent.
- Edit/delete are allowed for author or admins; others are blocked.
- README documents new capabilities.
