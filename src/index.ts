import { App } from '@slack/bolt'
import { config } from 'dotenv'
import { db } from './services/database'
import { registerListeners } from './listeners'

config()

const { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN, DATABASE_PATH } = process.env

if (!SLACK_BOT_TOKEN || !SLACK_SIGNING_SECRET) {
  console.error('Missing required environment variables:')
  console.error('  - SLACK_BOT_TOKEN')
  console.error('  - SLACK_SIGNING_SECRET')
  console.error('\nPlease set these in your .env file or environment.')
  process.exit(1)
}

const appOptions: {
  token: string
  signingSecret: string
  socketMode?: boolean
  appToken?: string
} = {
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
}

if (SLACK_APP_TOKEN) {
  appOptions.socketMode = true
  appOptions.appToken = SLACK_APP_TOKEN
}

const app = new App(appOptions)

registerListeners(app)

async function verifyToken(): Promise<void> {
  try {
    const authResult = await app.client.auth.test()
    if (!authResult.ok) {
      throw new Error(`Auth test returned not ok: ${authResult.error}`)
    }
    console.log(`Authenticated as @${authResult.user} (bot: ${authResult.bot_id}) in workspace: ${authResult.team}`)
  } catch (error: unknown) {
    const err = error as { code?: string; data?: { error?: string }; message?: string }
    if (err?.data?.error === 'account_inactive') {
      console.error('\n❌ Token Error: Your Slack bot token is inactive.')
      console.error('   This usually means:')
      console.error('   - The Slack app was reinstalled to the workspace (tokens change on reinstall)')
      console.error('   - The app was removed from the workspace')
      console.error('   - The token was manually revoked')
      console.error('\n   To fix:')
      console.error('   1. Go to https://api.slack.com/apps')
      console.error('   2. Find your "Kudos Digest" app')
      console.error('   3. Go to Settings → Install App / OAuth & Permissions')
      console.error('   4. Click "Reinstall to Workspace"')
      console.error('   5. Copy the new SLACK_BOT_TOKEN into your .env file')
      console.error('\n   Current (stale) token prefix:', SLACK_BOT_TOKEN?.substring(0, 15) + '...')
      process.exit(1)
    }
    if (err?.data?.error === 'invalid_auth') {
      console.error('\n❌ Token Error: Your Slack bot token is invalid.')
      console.error('   The token format appears wrong. Check that your .env SLACK_BOT_TOKEN starts with "xoxb-"')
      process.exit(1)
    }
    throw error
  }
}

async function main(): Promise<void> {
  try {
    await db.initialize(DATABASE_PATH ?? './kudos.db')
    console.log('Database initialized')

    await verifyToken()

    const port = parseInt(process.env.PORT ?? '3000', 10)
    await app.start(port)

    console.log(`Kudos Digest app is running on port ${port}! ⚡️`)

    if (SLACK_APP_TOKEN) {
      console.log('Using Socket Mode - no public URL needed')
    } else {
      console.log(`Please set Request URL to: http://localhost:${port}/slack/events`)
    }
  } catch (error) {
    const err = error as { code?: string; data?: { error?: string }; message?: string }
    if (err?.data?.error === 'account_inactive' || err?.data?.error === 'invalid_auth') {
      // Already handled in verifyToken — no need to re-print
    } else {
      console.error('Failed to start app:', error)
    }
    process.exit(1)
  }
}

main()
