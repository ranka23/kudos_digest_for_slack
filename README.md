# Kudos Digest

A Slack app that captures informal praise and compiles weekly recognition digests, with optional AI-powered summaries.

## Features

- `/kudos @user reason` — Give recognition to teammates with optional emoji
- `/kudos-export start_date end_date` — Export kudos to CSV for managers
- `/kudos-export-google start_date end_date` — Export kudos formatted for Google Docs/Sheets
- Weekly digest generation with AI-powered insights (optional)
- App Home view to manage kudos entries (Edit / Delete)
- Configurable settings (digest channel, schedule, AI provider, style)

---

## Setup

### Prerequisites

- Node.js 18+ (Node 22+ recommended for built-in SQLite)
- A Slack workspace with permissions to install apps
- (Optional) OpenAI/Anthropic/other AI API key for creative digests
- `pnpm` (install via `npm install -g pnpm`)

### 1. Clone and Install

```bash
git clone <repo-url>
cd slack_kudos
pnpm install
```

### 2. Create a Slack App

1. Go to **https://api.slack.com/apps**
2. Click **Create New App → From an app manifest**
3. Select your workspace, click **Next**
4. Paste the contents of `manifest.yml` into the editor, click **Next → Create**
5. Go to **Settings → Install App**, click **Install to Workspace**, then **Allow**

### 3. Configure Environment Variables

Copy the sample file and follow the instructions inside:

```bash
cp .env.sample .env
```

Then open `.env` in your editor. The sample has detailed comments showing exactly where to find each value in the Slack API dashboard.

**Quick reference — where to find each value:**

| Variable | Where to find it in https://api.slack.com/apps |
|----------|------------------------------------------------|
| `SLACK_BOT_TOKEN` | **OAuth & Permissions** → **Bot User OAuth Token** (starts with `xoxb-`). Generated after clicking **Install to Workspace**. |
| `SLACK_SIGNING_SECRET` | **Basic Information** → **App Credentials** → **Signing Secret** |
| `SLACK_APP_TOKEN` | **Socket Mode** → Enable it → **Generate an app-level token** with scope `connections:write` (starts with `xapp-`) |

> **Socket Mode note:** The app automatically uses Socket Mode when `SLACK_APP_TOKEN` is set. This lets you run locally without exposing a public URL or using tunneling tools like ngrok.

### 4. Run the App

**Development** (with hot reload):
```bash
pnpm dev
```

**Production**:
```bash
pnpm build
pnpm start
```

You should see:
```
Database initialized
Authenticated as @your-bot-name (bot: Bxxxxx) in workspace: Your Workspace
Kudos Digest app is running on port 3000! ⚡️
Using Socket Mode - no public URL needed
```

> **Troubleshooting:** If you see `❌ Token Error: Your Slack bot token is inactive`, the token in `.env` is stale. Reinstall the app from the Slack API dashboard to get a fresh token, or see the error message for detailed steps.

---

## Usage Guide

### 1. Open the App Home

After installation, click **Apps → Kudos Digest** in the Slack sidebar. The **Home tab** shows:
- Recent kudos with **Edit** and **Delete** buttons
- A **Settings** button to configure digests
- A **Generate Weekly Digest** button for manual triggers

### 2. Give Kudos

**Give kudos to a teammate:**
```
/kudos @alice Great presentation yesterday!
```
The bot posts in the channel:  
> 🎉 Kudos given to @alice for: "Great presentation yesterday!"

**Multiple recipients:**
```
/kudos @alice @bob Thanks for staying late to fix the bug
```

**With a custom emoji:**
```
/kudos @alice Your code review was thorough :star:
```

Supported emojis: `:tada:` `:star:` `:clap:` `:heart:` `:rocket:` `:sparkles:` `:trophy:` `:thumbsup:` `:fire:` `:smile:`

All kudos are stored in a local SQLite database and displayed on the App Home.

### 3. Manage Kudos

From the **App Home**, each kudos entry has two buttons:

- **Edit** — Opens a modal to change the reason and emoji
- **Delete** — Prompts for confirmation, then removes the kudos

**Permissions:**
- The person who gave the kudos can edit/delete it
- Workspace admins can edit/delete any kudos

### 4. Export Kudos

**CSV export** (paste into Excel, Google Sheets, etc.):
```
/kudos-export 2024-01-01 2024-12-31
```

**Filter by channel:**
```
/kudos-export 2024-01-01 2024-12-31 @general
```

**Google Docs/Sheets formatted export:**
```
/kudos-export-google 2024-01-01 2024-12-31
```
Returns two blocks: one formatted for Google Docs (grouped by recipient) and one CSV block for Google Sheets.

### 5. Configure the Weekly Digest

Open the App Home and click **Settings**. Configure:

| Setting | Description |
|---------|-------------|
| **Digest Channel** | Which channel the weekly digest is posted to |
| **Digest Day** | Day of the week (Monday–Sunday) |
| **Digest Hour (UTC)** | What time to post |
| **AI Provider** | `None` (simple digest), `OpenAI`, `Anthropic`, or `Custom` |
| **API Key** | Your AI provider's API key |
| **Model Name** | e.g. `gpt-4o-mini`, `claude-3-opus-20240229` |
| **Base URL** | For custom OpenAI-compatible endpoints |
| **Digest Style** | `Simple` (structured text) or `Creative` (AI narrative) |
| **Workflow Trigger ID** | Optional, for Slack Workflow integration |

Click **Save Settings** — the bot confirms via DM.

### 6. Generate Digest Manually

Click **Generate Weekly Digest** on the App Home to immediately post a digest to the configured channel.

### 7. Automated Digests (Slack Workflows)

The app listens for the `workflow_run_executed` event. To automate:

1. Configure the **Workflow Trigger ID** in Settings
2. Create a Slack Workflow with a schedule trigger
3. Use the trigger ID to fire the Kudos Digest workflow

The bot will generate and post the weekly digest automatically.

---

## Digest Examples

### Simple digest (no AI)
> *Weekly Kudos Digest 🎉*
>
> **@alice** received 3 kudos:
>   - "Great presentation!"
>   - "Thanks for mentoring"
>   - "Awesome debugging"
>
> **@bob** received 2 kudos:
>   - "Fixed the production issue"
>   - "Helpful code review"
>
> Total recognition this week: 5 kudos given! ⭐

### Creative digest (AI-powered)
When configured with an OpenAI/Anthropic API key and the "Creative" style, the digest is generated by AI, analyzing themes and highlighting the most meaningful kudos — warm, engaging, and tailored to your team's culture.

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `/kudos @user reason :emoji:` | Give kudos to someone |
| `/kudos @user1 @user2 reason` | Give kudos to multiple people |
| `/kudos-export YYYY-MM-DD YYYY-MM-DD` | Export kudos to CSV |
| `/kudos-export YYYY-MM-DD YYYY-MM-DD @channel` | Export kudos filtered by channel |
| `/kudos-export-google YYYY-MM-DD YYYY-MM-DD` | Export formatted for Google Docs/Sheets |
| App Home → Edit | Edit a kudos reason/emoji |
| App Home → Delete | Delete a kudos entry |
| App Home → Settings | Configure digest channel, schedule, AI |
| App Home → Generate Weekly Digest | Post digest immediately |

---

## Project Structure

```
src/
├── index.ts                 # App entry point, auth, server startup
├── listeners/
│   └── index.ts             # Slash commands, events, actions, views
├── services/
│   ├── ai.ts                # AI service (OpenAI / Anthropic / custom)
│   └── database.ts          # SQLite database service
├── types/
│   └── index.ts             # TypeScript interfaces (Kudos, Settings)
└── utils/
    └── helpers.ts           # Parsing, validation, formatting utilities
```

## Architecture

- **@slack/bolt** — Slack framework for Node.js
- **node:sqlite** — Built-in SQLite (Node 22+) for local persistence
- **openai** — OpenAI SDK for AI-powered digest generation
- **dotenv** — Environment variable management

## Testing

```bash
pnpm test              # Run tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # Coverage report
```

## Running with Docker

```bash
docker compose up -d
```

Ensure `.env` is configured with the required Slack credentials.

## License

MIT