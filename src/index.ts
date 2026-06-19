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

async function main(): Promise<void> {
  try {
    await db.initialize(DATABASE_PATH ?? './kudos.db')
    console.log('Database initialized')

    const port = parseInt(process.env.PORT ?? '3000', 10)
    await app.start(port)

    console.log(`Kudos Digest app is running on port ${port}! ⚡️`)

    if (SLACK_APP_TOKEN) {
      console.log('Using Socket Mode - no public URL needed')
    } else {
      console.log(`Please set Request URL to: http://localhost:${port}/slack/events`)
    }
  } catch (error) {
    console.error('Failed to start app:', error)
    process.exit(1)
  }
}

main()
