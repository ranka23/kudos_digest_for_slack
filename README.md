# Kudos Digest

A Slack app that captures informal praise and compiles weekly recognition digests.

## Features

- `/kudos @user reason` - Give recognition to teammates with optional emoji
- `/kudos-export start_date end_date` - Export kudos to CSV for managers
- `/kudos-export-google start_date end_date` - Export kudos formatted for Google Docs/Sheets
- Weekly digest generation with AI-powered insights (optional)
- App Home view to manage kudos entries (CRUD)
- Configurable settings (digest channel, schedule, AI provider)

## Setup

### Prerequisites

- Node.js 18+ installed
- A Slack workspace with permissions to install apps
- (Optional) OpenAI/Anthropic/other AI API key for creative digests

### Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Copy `.env.sample` to `.env` and fill in your credentials:
   ```bash
   cp .env.sample .env
   ```

4. Create a Slack app:
   - Go to https://api.slack.com/apps/new
   - Choose "From an app manifest" and use `manifest.yml`
   - Install to your workspace

5. Set environment variables:
   - `SLACK_BOT_TOKEN` - Bot token from your Slack app
   - `SLACK_SIGNING_SECRET` - Signing secret from your Slack app
   - `SLACK_APP_TOKEN` - App token for Socket Mode (optional)

### Running

Development mode (with hot reload):
```bash
pnpm dev
```

Production build:
```bash
pnpm build
pnpm start
```

## Usage

### Give Kudos

```
/kudos @alice Great work on the presentation! :star:
/kudos @bob @charlie Thanks for the teamwork :tada:
```

### Export Kudos

```
/kudos-export 2024-01-01 2024-01-31
```

### Configure Settings

Open the App Home and click "Settings" to configure:
- Digest channel
- Digest day/time (UTC)
- AI provider and API key
- Digest style (simple or creative)

## Architecture

- **Bolt JS** - Slack framework for JavaScript
- **SQLite** - Local database for persistence
- **OpenAI SDK** - AI integration for digest generation

## Testing

```bash
pnpm test              # Run tests
pnpm test:watch        # Watch mode
pnpm test:coverage     # Coverage report
```

## License

MIT