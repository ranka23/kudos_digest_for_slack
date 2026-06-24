# Privacy Policy for Kudos Digest

**Last updated: June 22, 2026**

## Data Collection

Kudos Digest collects and stores the following data:

- **User IDs and usernames** — Required to track who gives and receives kudos
- **Channel IDs and names** — Required to display which channel kudos were given in
- **Kudos content** — The reason text, emoji, and timestamp of each kudos given
- **Reactions** — User reactions added to kudos entries
- **Workspace settings** — Digest channel, day, hour, AI provider configuration
- **Workspace ID** — Required to separate data between different Slack workspaces

## Data Storage

All data is stored locally in a SQLite database file (`kudos.db`) on the server where the app is deployed. No data is sent to third-party services unless you explicitly configure an AI provider API key (OpenAI or Anthropic) for generating creative digests.

## AI Provider Data

If you configure an AI provider API key:
- Kudos data (user names, reasons, emojis) will be sent to the configured AI provider (OpenAI, Anthropic, or a custom OpenAI-compatible endpoint) for digest generation
- This data is processed according to the AI provider's own privacy policy
- You can disable AI features at any time by setting AI Provider to "None" in Settings

## Data Retention

Kudos data is retained until explicitly deleted by a workspace admin through the app's delete functionality. There is no automatic data expiration.

## Data Deletion

Users can delete individual kudos entries. To request full data deletion for a workspace, please open an issue on our GitHub repository.

## Third-Party Services

- **QR Code API** (`api.qrserver.com`) — Used to generate QR code images for the donate modal when viewed. No user data is transmitted.
- **AI Providers** (OpenAI, Anthropic) — Only when you voluntarily configure them.

## Contact

For privacy concerns, please open an issue at:
https://github.com/ranka23/kudos_digest_for_slack/issues