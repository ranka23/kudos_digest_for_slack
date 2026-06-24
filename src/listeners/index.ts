import { App } from '@slack/bolt'
import { db } from '../services/database'
import { aiService } from '../services/ai'
import { parseKudosCommand, generateKudosId, SUPPORTED_EMOJIS, formatKudosForGoogleDocs, kudosToCsv, validateKudosInput, parseDateMMDDYYYY } from '../utils/helpers'
import type { Kudos } from '../types/index'

const PAGE_SIZE = 11

export async function getChannelIdFromName(teamId: string, channelName: string, client: { conversations: { list: (_params: { team_id: string; types?: string }) => Promise<unknown> } } | null): Promise<string | null> {
  if (!client?.conversations?.list) return null
  try {
    const channelsResponse = await client.conversations.list({ team_id: teamId, types: 'public_channel,private_channel,mpim,im' })
    const channels = (channelsResponse as { channels?: { id: string; name: string }[] }).channels ?? []
    const channel = channels.find((c) => c.name === channelName.toLowerCase())
    return channel?.id ?? null
  } catch { return null }
}

async function isAuthorizedForKudos(userId: string, kudos: { fromUserId: string }, client: { users: { info: (_params: { user: string }) => Promise<unknown> } }): Promise<boolean> {
  if (kudos.fromUserId === userId) return true
  const result = await client.users.info({ user: userId })
  const user = result as { user?: { is_admin?: boolean } }
  return !!user.user?.is_admin
}

async function isAdminUser(userId: string, client: { users: { info: (_params: { user: string }) => Promise<unknown> } }): Promise<boolean> {
  try {
    const result = await client.users.info({ user: userId })
    const user = result as { user?: { is_admin?: boolean } }
    return !!user.user?.is_admin
  } catch { return false }
}

async function refreshHomeForUser(_userId: string, _workspaceId: string): Promise<void> {}

async function resolveUserIds(usernames: string[], client: App['client']): Promise<{ resolved: Map<string, string>; resolvedNames: Map<string, string>; unresolved: string[] }> {
  const resolved = new Map<string, string>()
  const resolvedNames = new Map<string, string>()
  const unresolved: string[] = []
  try {
    const result = await client.users.list({})
    const members = (result as { members?: Array<{ id: string; name: string; profile?: { display_name?: string; real_name?: string } }> }).members ?? []
    for (const username of usernames) {
      if (/^U[A-Za-z0-9]+$/.test(username) && username.length > 5) {
        resolved.set(username, username)
        resolvedNames.set(username, username)
        continue
      }
      const member = members.find(m => m.name === username || m.profile?.display_name === username || m.profile?.real_name === username)
      if (member) {
        resolved.set(username, member.id)
        resolvedNames.set(username, member.profile?.display_name ?? member.profile?.real_name ?? member.name)
      } else {
        unresolved.push(username)
      }
    }
  } catch (error) {
    console.error('Failed to fetch user list:', error)
    unresolved.push(...usernames.filter(u => !/^U[A-Za-z0-9]+$/.test(u) || u.length <= 5))
  }
  return { resolved, resolvedNames, unresolved }
}

function formatErrorMessage(error: unknown): { userMessage: string; consoleMessage: string } {
  const err = error as { code?: string; data?: { error?: string }; message?: string } | undefined
  const apiError = err?.data?.error
  const message = err?.message ?? 'Unknown error'
  if (apiError === 'user_not_found') return { userMessage: '❌ User not found. The user may have left the workspace or the username is incorrect. Please check the name and try again.', consoleMessage: `User not found error: ${message}` }
  if (apiError === 'not_in_channel') return { userMessage: '❌ The bot is not in that channel. Please invite @Kudos Digest to the channel first, then try again.', consoleMessage: `Bot not in channel: ${message}` }
  if (apiError === 'invalid_auth' || apiError === 'account_inactive') return { userMessage: '❌ Authentication error. The bot token may be invalid or expired. Please contact your workspace admin.', consoleMessage: `Auth error: ${message}` }
  if (apiError === 'ratelimited') return { userMessage: '❌ Too many requests. Please wait a moment and try again.', consoleMessage: `Rate limited: ${message}` }
  if (err?.code === 'slack_webapi_platform_error') return { userMessage: '❌ Slack API error. Please try again. If the issue persists, contact your workspace admin.', consoleMessage: `Slack API error: ${message}` }
  if (message.includes('Database not initialized') || message.includes('SQLITE')) return { userMessage: '❌ Database error. Please try again. If the issue persists, restart the app.', consoleMessage: `Database error: ${message}` }
  return { userMessage: '❌ Something went wrong. Please try again. If the issue persists, contact your workspace admin.', consoleMessage: `Unexpected error: ${message}` }
}

export function registerListeners(app: App): void {
  app.command('/kudos', async ({ command, ack, respond, client }) => {
    try {
      await ack()
      const workspaceId = command.team_id
      const { userIds, reason, emoji } = parseKudosCommand(command.text)
      const validationError = validateKudosInput(userIds, reason)
      if (validationError) {
        await respond({ text: validationError, response_type: 'ephemeral' })
        return
      }
      let channelName = 'unknown'
      try {
        const channelInfo = await client.conversations.info({ channel: command.channel_id }).catch(() => null)
        channelName = channelInfo?.channel?.name ?? 'unknown'
      } catch { channelName = 'unknown' }

      const { resolved, resolvedNames, unresolved } = await resolveUserIds(userIds, client)
      const successMessages: string[] = []
      const errorMessages: string[] = []

      for (const [originalUsername, resolvedUserId] of resolved.entries()) {
        try {
          const userName = resolvedNames.get(originalUsername) ?? originalUsername
          const kudos: Kudos = {
            id: generateKudosId(), fromUserId: command.user_id, fromUserName: command.user_name,
            toUserId: resolvedUserId, toUserName: userName, reason, emoji,
            channelId: command.channel_id, channelName, createdAt: new Date().toISOString(), workspaceId,
          }
          await db.createKudos(kudos)
          successMessages.push(`<@${resolvedUserId}>`)
        } catch (error) {
          console.error(`Failed to create kudos for ${originalUsername}:`, error)
          errorMessages.push(`<@${resolvedUserId}>`)
        }
      }
      for (const unresolvedUser of unresolved) { errorMessages.push(`"${unresolvedUser}"`) }

      if (successMessages.length > 0) {
        const usersText = successMessages.join(', ')
        const senderName = command.user_name || `<@${command.user_id}>`
        await client.chat.postMessage({
          channel: command.channel_id,
          text: `*${emoji} "${reason}" ${emoji}*\nKudos to ${usersText} from ${senderName}`,
        })
      }
      if (errorMessages.length > 0) {
        const failedUsersText = errorMessages.join(', ')
        const hasUnresolved = unresolved.length > 0
        await respond({
          text: hasUnresolved
            ? `❌ Couldn't find user(s) ${failedUsersText}. This usually means the username is misspelled or they're not in this workspace. Please check the name and try again.`
            : `❌ Failed to give kudos to ${failedUsersText}. They may not exist or the bot lacks permission.`,
          response_type: 'ephemeral',
        })
      }
      await refreshHomeForUser(command.user_id, workspaceId).catch((e) => console.error('Home refresh failed:', e))
    } catch (error) {
      console.error('Slash command /kudos failed:', error)
      const { userMessage } = formatErrorMessage(error)
      try { await respond({ text: userMessage, response_type: 'ephemeral' }) } catch { /* silent */ }
    }
  })

  app.command('/kudos-export', async ({ command, ack, respond, client }) => {
    try {
      await ack()
      const workspaceId = command.team_id
      const parts = command.text.trim().split(/\s+/)
      const startDate = parts[0] ?? ''
      const endDate = parts[1] ?? ''
      const channelName = parts[2] ?? ''

      if (!startDate || !endDate) {
        await respond({ text: 'Usage: `/kudos-export [start_date: mm-dd-yyyy] [end_date: mm-dd-yyyy] [#channel_name]`\nExample: `/kudos-export 01-01-2024 01-31-2024`\nExample: `/kudos-export 01-01-2024 01-31-2024 #general`', response_type: 'ephemeral' })
        return
      }
      const start = parseDateMMDDYYYY(startDate)
      const end = parseDateMMDDYYYY(endDate)
      if (!start || !end) {
        await respond({ text: '❌ Invalid date format. Please use mm-dd-yyyy format.\nExample: `/kudos-export 01-01-2024 01-31-2024`', response_type: 'ephemeral' })
        return
      }
      const startIso = start.toISOString()
      const endIso = end.toISOString()
      let kudosList: Kudos[]
      if (channelName && channelName.startsWith('#')) {
        const channelId = await getChannelIdFromName(command.channel_id, channelName.replace(/^#/, ''), client)
        if (channelId) {
          kudosList = await db.getKudosByDateRangeAndChannel(workspaceId, startIso, endIso, channelId)
        } else {
          await respond({ text: `❌ Channel ${channelName} not found. The app may not be a member of that channel. Invite @Kudos Digest to the channel and try again.`, response_type: 'ephemeral' })
          return
        }
      } else {
        kudosList = await db.getKudosByDateRange(workspaceId, startIso, endIso)
      }
      if (kudosList.length === 0) {
        await respond({ text: `No kudos found${channelName ? ` in channel ${channelName}` : ''} between ${startDate} and ${endDate}.`, response_type: 'ephemeral' })
        return
      }
      const exportData = kudosList.map((k) => ({ fromUser: k.fromUserName, toUser: k.toUserName, reason: k.reason, emoji: k.emoji, channel: k.channelName ?? 'unknown', date: k.createdAt }))
      const csv = kudosToCsv(exportData)
      await respond({
        text: `Here's your kudos export (${kudosList.length} entries):`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `Here's your kudos export for ${startDate} to ${endDate}${channelName ? ` in channel ${channelName}` : ''}:` } },
          { type: 'section', text: { type: 'mrkdwn', text: '```' + csv + '```' } },
        ],
        response_type: 'ephemeral',
      })
    } catch (error) {
      console.error('Export failed:', error)
      const { userMessage } = formatErrorMessage(error)
      await respond({ text: userMessage + '\n\nPlease check the date format (YYYY-MM-DD) and try again.', response_type: 'ephemeral' })
    }
  })

  app.command('/kudos-export-google', async ({ command, ack, respond }) => {
    try {
      await ack()
      const workspaceId = command.team_id
      const parts = command.text.trim().split(/\s+/)
      const startDate = parts[0] ?? ''
      const endDate = parts[1] ?? ''
      const channelName = parts[2] ?? ''
      if (!startDate || !endDate) {
        await respond({ text: 'Usage: `/kudos-export-google [start_date: mm-dd-yyyy] [end_date: mm-dd-yyyy] [#channel_name]`\nExample: `/kudos-export-google 01-01-2024 01-31-2024`\nExample: `/kudos-export-google 01-01-2024 01-31-2024 #general`', response_type: 'ephemeral' })
        return
      }
      const start = parseDateMMDDYYYY(startDate)
      const end = parseDateMMDDYYYY(endDate)
      if (!start || !end) {
        await respond({ text: '❌ Invalid date format. Please use mm-dd-yyyy format.\nExample: `/kudos-export-google 01-01-2024 01-31-2024`', response_type: 'ephemeral' })
        return
      }
      const startIso = start.toISOString()
      const endIso = end.toISOString()
      let kudosList: Kudos[]
      if (channelName && channelName.startsWith('#')) {
        const channelId = await getChannelIdFromName(command.channel_id, channelName.replace(/^#/, ''), command.client)
        if (channelId) {
          kudosList = await db.getKudosByDateRangeAndChannel(workspaceId, startIso, endIso, channelId)
        } else {
          await respond({ text: `❌ Channel ${channelName} not found. The app may not be a member of that channel. Invite @Kudos Digest to the channel and try again.`, response_type: 'ephemeral' })
          return
        }
      } else {
        kudosList = await db.getKudosByDateRange(workspaceId, startIso, endIso)
      }
      if (kudosList.length === 0) {
        await respond({ text: `No kudos found${channelName ? ` in channel ${channelName}` : ''} between ${startDate} and ${endDate}.`, response_type: 'ephemeral' })
        return
      }
      const googleDocBlock = formatKudosForGoogleDocs(kudosList.map((k) => ({ reason: k.reason, emoji: k.emoji, fromUserName: k.fromUserName, toUserName: k.toUserName })), startDate, endDate)
      const csvBlock = kudosToCsv(kudosList.map((k) => ({ fromUser: k.fromUserName, toUser: k.toUserName, reason: k.reason, emoji: k.emoji, channel: k.channelName ?? 'unknown', date: k.createdAt })))
      await respond({
        text: `Google export for ${startDate} to ${endDate}${channelName ? ` in channel ${channelName}` : ''}:`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: '*Google Docs format (copy/paste this block):*' } },
          { type: 'section', text: { type: 'mrkdwn', text: '```' + googleDocBlock + '```' } },
          { type: 'section', text: { type: 'mrkdwn', text: '*Google Sheets format (copy/paste this CSV block):*' } },
          { type: 'section', text: { type: 'mrkdwn', text: '```' + csvBlock + '```' } },
          { type: 'section', text: { type: 'mrkdwn', text: '_Tip: Copy into Google Docs or Google Sheets manually._' } },
        ],
        response_type: 'ephemeral',
      })
    } catch (error) {
      console.error('Google export failed:', error)
      const { userMessage } = formatErrorMessage(error)
      await respond({ text: userMessage + '\n\nPlease check the date format (YYYY-MM-DD) and try again.', response_type: 'ephemeral' })
    }
  })

  // ── Home Tab (Kudos Board) ─────────────────────────────────────
  app.event('app_home_opened', async ({ event, client }) => {
    const workspaceId = (event as { team_id?: string }).team_id ?? ''
    const userId = event.user
    try {
      const settings = await db.getSettings(workspaceId)
      const totalCount = await db.getKudosCount(workspaceId)
      const kudosList = await db.getKudosByWorkspace(workspaceId, PAGE_SIZE, 0, 'latest')
      const isAdmin = await isAdminUser(userId, client)
      await client.views.publish({
        user_id: userId,
        view: {
          type: 'home',
          callback_id: 'home_view',
          blocks: buildKudosBoard(kudosList, settings, totalCount, 1, 'latest', '', isAdmin, userId),
        },
      })
    } catch (error) {
      const err = error as { code?: string; data?: { error?: string } }
      if (err?.code === 'not_enabled' || err?.data?.error === 'not_enabled') { console.warn('Home tab not enabled'); return }
      console.error('Failed to publish home view:', error)
    }
  })

  // ── Pagination ──────────────────────────────────────────────────
  app.action(/^kudos_page_(\d+)$/, async ({ body, ack, client }) => {
    await ack()
    const match = (body as { actions?: { action_id?: string }[] }).actions?.[0]?.action_id?.match(/^kudos_page_(\d+)$/)
    const page = match ? parseInt(match[1], 10) : 1
    const teamId = (body as { team?: { id?: string } }).team?.id ?? ''
    const userId = (body as { user?: { id?: string } }).user?.id ?? ''
    try {
      const settings = await db.getSettings(teamId)
      const totalCount = await db.getKudosCount(teamId)
      const kudosList = await db.getKudosByWorkspace(teamId, PAGE_SIZE, (page - 1) * PAGE_SIZE, 'latest')
      const isAdmin = await isAdminUser(userId, client)
      await client.views.publish({
        user_id: userId,
        view: { type: 'home', callback_id: 'home_view', blocks: buildKudosBoard(kudosList, settings, totalCount, page, 'latest', '', isAdmin, userId) },
      })
    } catch (error) { console.error('Pagination failed:', error) }
  })

  // ── Sort ────────────────────────────────────────────────────────
  app.action('kudos_sort_toggle', async ({ body, ack, client }) => {
    await ack()
    const teamId = (body as { team?: { id?: string } }).team?.id ?? ''
    const userId = (body as { user?: { id?: string } }).user?.id ?? ''
    const match = (body as { actions?: { action_id?: string }[] }).actions?.[0]?.action_id?.match(/^kudos_sort_(.+)$/)
    const currentSort = (match?.[1] ?? 'latest') as 'latest' | 'oldest' | 'reactions'
    const nextSort = currentSort === 'latest' ? 'oldest' : currentSort === 'oldest' ? 'reactions' : 'latest'
    try {
      const settings = await db.getSettings(teamId)
      const totalCount = await db.getKudosCount(teamId)
      const kudosList = await db.getKudosByWorkspace(teamId, PAGE_SIZE, 0, nextSort)
      const isAdmin = await isAdminUser(userId, client)
      await client.views.publish({
        user_id: userId,
        view: { type: 'home', callback_id: 'home_view', blocks: buildKudosBoard(kudosList, settings, totalCount, 1, nextSort, '', isAdmin, userId) },
      })
    } catch (error) { console.error('Sort failed:', error) }
  })

  // ── Search Modal ─────────────────────────────────────────────────
  app.action('kudos_open_search', async ({ ack, client, body }) => {
    await ack()
    try {
      await client.views.open({
        trigger_id: (body as { trigger_id?: string }).trigger_id ?? '',
        view: {
          type: 'modal',
          callback_id: 'kudos_search_modal',
          title: { type: 'plain_text', text: 'Search Kudos' },
          submit: { type: 'plain_text', text: 'Search' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: [
            { type: 'input', block_id: 'search_query', element: { type: 'plain_text_input', action_id: 'query', placeholder: { type: 'plain_text', text: 'Search by username, channel, or reason…' } }, label: { type: 'plain_text', text: 'Search' } },
          ],
        },
      })
    } catch (error) { console.error('Search modal failed:', error) }
  })

  app.view('kudos_search_modal', async ({ ack, view, client, body }) => {
    await ack()
    const query = (view.state.values as Record<string, Record<string, { value?: string }>>).search_query?.query?.value ?? ''
    const teamId = (body as { team?: { id?: string } }).team?.id ?? ''
    const userId = (body as { user?: { id?: string } }).user?.id ?? ''
    try {
      const settings = await db.getSettings(teamId)
      const kudosList = query ? await db.searchKudos(teamId, query, PAGE_SIZE, 0) : await db.getKudosByWorkspace(teamId, PAGE_SIZE, 0, 'latest')
      const totalCount = query ? kudosList.length : await db.getKudosCount(teamId)
      const isAdmin = await isAdminUser(userId, client)
      await client.views.publish({
        user_id: userId,
        view: { type: 'home', callback_id: 'home_view', blocks: buildKudosBoard(kudosList, settings, totalCount, 1, 'latest', query, isAdmin, userId) },
      })
    } catch (error) { console.error('Search failed:', error) }
  })

  // ── Reaction handlers ────────────────────────────────────────────
  app.action(/^react_(.+)_(.+)$/, async ({ body, ack, client }) => {
    await ack()
    const match = (body as { actions?: { action_id?: string }[] }).actions?.[0]?.action_id?.match(/^react_(.+)_(.+)$/)
    if (!match) return
    const kudosId = match[1]
    const reaction = match[2]
    const userId = (body as { user?: { id?: string } }).user?.id ?? ''
    try {
      await db.addReaction(`reaction_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, kudosId, userId, reaction)
      const teamId = (body as { team?: { id?: string } }).team?.id ?? ''
      const settings = await db.getSettings(teamId)
      const totalCount = await db.getKudosCount(teamId)
      const kudosList = await db.getKudosByWorkspace(teamId, PAGE_SIZE, 0, 'latest')
      const isAdmin = await isAdminUser(userId, client)
      await client.views.publish({
        user_id: userId,
        view: { type: 'home', callback_id: 'home_view', blocks: buildKudosBoard(kudosList, settings, totalCount, 1, 'latest', '', isAdmin, userId) },
      })
    } catch (error) { console.error('Reaction failed:', error) }
  })

  app.action(/^unreact_(.+)_(.+)$/, async ({ body, ack, client }) => {
    await ack()
    const match = (body as { actions?: { action_id?: string }[] }).actions?.[0]?.action_id?.match(/^unreact_(.+)_(.+)$/)
    if (!match) return
    const kudosId = match[1]
    const reaction = match[2]
    const userId = (body as { user?: { id?: string } }).user?.id ?? ''
    try {
      await db.removeReaction(kudosId, userId, reaction)
      const teamId = (body as { team?: { id?: string } }).team?.id ?? ''
      const settings = await db.getSettings(teamId)
      const totalCount = await db.getKudosCount(teamId)
      const kudosList = await db.getKudosByWorkspace(teamId, PAGE_SIZE, 0, 'latest')
      const isAdmin = await isAdminUser(userId, client)
      await client.views.publish({
        user_id: userId,
        view: { type: 'home', callback_id: 'home_view', blocks: buildKudosBoard(kudosList, settings, totalCount, 1, 'latest', '', isAdmin, userId) },
      })
    } catch (error) { console.error('Unreact failed:', error) }
  })

  // ── Settings ─────────────────────────────────────────────────────
  app.action('open_settings', async ({ ack, client, body }) => {
    await ack()
    const triggerId = (body as { trigger_id?: string }).trigger_id ?? ''
    const workspaceId = (body as { team?: { id?: string } }).team?.id ?? ''
    try {
      const settings = await db.getSettings(workspaceId)
      await client.views.open({
        trigger_id: triggerId,
        view: { type: 'modal', callback_id: 'settings_modal', title: { type: 'plain_text', text: 'Kudos Digest Settings' }, blocks: buildSettingsModal(settings) as any, submit: { type: 'plain_text', text: 'Save Settings' }, close: { type: 'plain_text', text: 'Cancel' } },
      })
    } catch (error) {
      console.error('Failed to open settings modal:', error)
      try { await client.chat.postMessage({ channel: (body as { user?: { id?: string } }).user?.id ?? '', text: '❌ Failed to open settings. Please try again.' }) } catch { /* silent */ }
    }
  })

  app.view('settings_modal', async ({ ack, view, client, body }) => {
    try {
      await ack()
      const teamId = (body as { team?: { id?: string } }).team?.id ?? ''
      const state = view.state.values as Record<string, Record<string, { selected_conversation?: string; selected_option?: { value?: string }; value?: string }>>
      const digestChannel = state.digest_channel_block?.digest_channel?.selected_conversation
      const digestDay = state.digest_day_block?.digest_day?.selected_option?.value
      const digestHour = state.digest_hour_block?.digest_hour?.selected_option?.value
      const aiProvider = state.ai_provider_block?.ai_provider?.selected_option?.value
      const aiApiKeyVal = state.ai_key_block?.ai_key?.value
      const aiModelVal = state.ai_model_block?.ai_model?.value
      const aiBaseUrlVal = state.ai_base_url_block?.ai_base_url?.value
      const digestStyle = state.digest_style_block?.digest_style?.selected_option?.value
      const workflowTriggerId = state.workflow_trigger_id_block?.workflow_trigger_id?.value
      const existing = await db.getSettings(teamId)
      const now = new Date().toISOString()
      await db.saveSettings({
        workspaceId: teamId,
        digestChannelId: digestChannel ?? existing?.digestChannelId ?? null,
        digestDay: digestDay ? parseInt(digestDay, 10) : existing?.digestDay ?? 5,
        digestHour: digestHour ? parseInt(digestHour, 10) : existing?.digestHour ?? 17,
        digestMinute: 0,
        aiProvider: (aiProvider ?? existing?.aiProvider ?? 'none') as 'openai' | 'anthropic' | 'custom' | 'none',
        aiApiKey: aiApiKeyVal ?? existing?.aiApiKey ?? null,
        aiModel: aiModelVal ?? existing?.aiModel ?? null,
        aiBaseUrl: aiBaseUrlVal ?? existing?.aiBaseUrl ?? null,
        digestStyle: (digestStyle ?? existing?.digestStyle ?? 'simple') as 'simple' | 'creative',
        workflowTriggerId: workflowTriggerId ?? existing?.workflowTriggerId ?? null,
        digestPostAt: existing?.digestPostAt ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      try { await client.chat.postMessage({ channel: (body as { user?: { id?: string } }).user?.id ?? '', text: ':white_check_mark: Settings saved successfully!' }) } catch { /* silent */ }
      await refreshHomeForUser((body as { user?: { id?: string } }).user?.id ?? '', teamId)
    } catch (error) {
      console.error('Failed to save settings:', error)
      try { await client.chat.postMessage({ channel: (body as { user?: { id?: string } }).user?.id ?? '', text: '❌ Failed to save settings. Please try again.' }) } catch { /* silent */ }
    }
  })

  // ── Edit / Delete / Donate / Manual Digest ──────────────────────
  app.action(/^edit_kudos_/, async ({ body, ack, client }) => {
    try {
      await ack()
      const actingUserId = (body as { user?: { id?: string } }).user?.id
      const kudosId = String((body as { actions?: { action_id?: string }[] }).actions?.[0]?.action_id ?? '').replace('edit_kudos_', '')
      if (!actingUserId || !kudosId) return
      const kudos = await db.getKudosById(kudosId)
      if (!kudos) { await client.chat.postMessage({ channel: actingUserId, text: '❌ Kudos not found. It may have been deleted.' }); return }
      const allowed = await isAuthorizedForKudos(actingUserId, kudos, client)
      if (!allowed) { await client.chat.postMessage({ channel: actingUserId, text: '❌ You are not allowed to edit this kudos.' }); return }
      await client.views.open({
        trigger_id: (body as { trigger_id?: string }).trigger_id ?? '',
        view: {
          type: 'modal', callback_id: `edit_kudos_modal_${kudosId}`, title: { type: 'plain_text', text: 'Edit Kudos' },
          blocks: [
            { type: 'input', block_id: 'reason_block', element: { type: 'plain_text_input', action_id: 'reason', initial_value: kudos.reason }, label: { type: 'plain_text', text: 'Reason' }, optional: false },
            { type: 'input', block_id: 'emoji_block', element: { type: 'static_select', action_id: 'emoji', options: SUPPORTED_EMOJIS.map((e) => ({ text: { type: 'plain_text', text: e }, value: e })), initial_option: { text: { type: 'plain_text', text: kudos.emoji }, value: kudos.emoji } }, label: { type: 'plain_text', text: 'Emoji' }, optional: false },
          ],
          submit: { type: 'plain_text', text: 'Save' }, close: { type: 'plain_text', text: 'Cancel' },
        },
      })
    } catch (error) { console.error('Edit modal failed:', error); try { await client.chat.postMessage({ channel: (body as { user?: { id?: string } }).user?.id ?? '', text: '❌ Failed to open edit modal.' }) } catch { /* silent */ } }
  })

  app.view(/^edit_kudos_modal_/, async ({ ack, view, body, client }) => {
    try {
      await ack()
      const match = /^edit_kudos_modal_(.+)$/.exec(view.callback_id)
      const kudosId = match?.[1] ?? ''
      const actingUserId = (body as { user?: { id?: string } }).user?.id ?? ''
      if (!kudosId || !actingUserId) return
      const kudos = await db.getKudosById(kudosId)
      if (!kudos) { await client.chat.postMessage({ channel: actingUserId, text: '❌ Kudos not found.' }); return }
      const allowed = await isAuthorizedForKudos(actingUserId, kudos, client)
      if (!allowed) { await client.chat.postMessage({ channel: actingUserId, text: '❌ You are not allowed to edit this kudos.' }); return }
      const values = view.state.values as Record<string, Record<string, { value?: string; selected_option?: { value?: string } }>>
      const reason = values.reason_block?.reason?.value ?? kudos.reason
      const emoji = values.emoji_block?.emoji?.selected_option?.value ?? kudos.emoji
      await db.updateKudos(kudosId, reason, emoji)
      await client.chat.postMessage({ channel: actingUserId, text: ':white_check_mark: Kudos updated.' })
      if (kudos.fromUserId) { await refreshHomeForUser(kudos.fromUserId, (body as { team?: { id?: string } }).team?.id ?? '') }
    } catch (error) { console.error('Update failed:', error); try { await client.chat.postMessage({ channel: (body as { user?: { id?: string } }).user?.id ?? '', text: '❌ Failed to update kudos.' }) } catch { /* silent */ } }
  })

  app.action(/^delete_kudos_/, async ({ body, ack, client }) => {
    try {
      await ack()
      const actingUserId = (body as { user?: { id?: string } }).user?.id
      const kudosId = String((body as { actions?: { action_id?: string }[] }).actions?.[0]?.action_id ?? '').replace('delete_kudos_', '')
      if (!actingUserId || !kudosId) return
      const kudos = await db.getKudosById(kudosId)
      if (!kudos) { await client.chat.postMessage({ channel: actingUserId, text: '❌ Kudos not found.' }); return }
      const allowed = await isAuthorizedForKudos(actingUserId, kudos, client)
      if (!allowed) { await client.chat.postMessage({ channel: actingUserId, text: '❌ You are not allowed to delete this kudos.' }); return }
      await db.deleteKudos(kudosId)
      await client.chat.postMessage({ channel: actingUserId, text: ':white_check_mark: Kudos deleted.' })
      if (kudos.fromUserId) { await refreshHomeForUser(kudos.fromUserId, (body as { team?: { id?: string } }).team?.id ?? '') }
    } catch (error) { console.error('Delete failed:', error); try { await client.chat.postMessage({ channel: (body as { user?: { id?: string } }).user?.id ?? '', text: '❌ Failed to delete kudos.' }) } catch { /* silent */ } }
  })

  app.action('open_donate', async ({ ack, client, body }) => {
    await ack()
    try {
      await client.views.open({
        trigger_id: (body as { trigger_id?: string }).trigger_id ?? '',
        view: { type: 'modal', callback_id: 'donate_modal', title: { type: 'plain_text', text: 'Support Kudos Digest' }, blocks: buildDonateModal(), close: { type: 'plain_text', text: 'Close' } },
      })
    } catch (error) { console.error('Donate modal failed:', error); try { await client.chat.postMessage({ channel: (body as { user?: { id?: string } }).user?.id ?? '', text: '❌ Failed to open Donate modal.' }) } catch { /* silent */ } }
  })

  app.action('manual_digest', async ({ ack, body, client }) => {
    await ack()
    const workspaceId = (body as { team?: { id?: string } }).team?.id ?? ''
    try {
      const settings = await db.getSettings(workspaceId)
      if (!settings?.digestChannelId) {
        await client.chat.postMessage({ channel: (body as { user?: { id?: string } }).user?.id ?? '', text: '❌ No digest channel configured. Open the App Home tab and click Settings to set up your digest channel.' })
        return
      }
      const weeklyKudos = await db.getWeeklyKudos(workspaceId, new Date())
      if (weeklyKudos.length === 0) {
        await client.chat.postMessage({ channel: (body as { user?: { id?: string } }).user?.id ?? '', text: 'No kudos found for this week. Use `/kudos @user reason` to give kudos!' })
        return
      }
      await aiService.configure({ aiProvider: settings.aiProvider ?? 'none', aiApiKey: settings.aiApiKey, aiModel: settings.aiModel, aiBaseUrl: settings.aiBaseUrl, digestStyle: settings.digestStyle })
      // Build reaction counts per user for the digest
      const kudosIds = weeklyKudos.map((k) => k.id)
      const reactionsGrouped = await db.getReactionsGrouped(kudosIds)
      const reactionCounts: Record<string, number> = {}
      for (const [, reactions] of Object.entries(reactionsGrouped)) {
        for (const r of reactions) {
          const kudo = weeklyKudos.find((k) => k.id === r.kudosId)
          if (kudo) {
            reactionCounts[kudo.toUserName] = (reactionCounts[kudo.toUserName] ?? 0) + 1
          }
        }
      }
      const digest = await aiService.generateDigest(weeklyKudos.map((k) => ({ fromUser: k.fromUserName, toUser: k.toUserName, reason: k.reason, emoji: k.emoji })), reactionCounts)
      await client.chat.postMessage({ channel: settings.digestChannelId, text: digest })
      await client.chat.postMessage({ channel: (body as { user?: { id?: string } }).user?.id ?? '', text: `:tada: Weekly digest posted to <#${settings.digestChannelId}>!` })
    } catch (error) {
      console.error('Manual digest failed:', error)
      await client.chat.postMessage({ channel: (body as { user?: { id?: string } }).user?.id ?? '', text: '❌ Failed to generate weekly digest.' })
    }
  })

  app.event('workflow_run_executed', async ({ event, client }) => {
    const workflowEvent = event as { workflow?: { step?: { name?: string; inputs?: { workspace_id?: string } } }; team?: string }
    const workspaceId = workflowEvent.workflow?.step?.inputs?.workspace_id ?? workflowEvent.team ?? ''
    if (!workspaceId) return
    try {
      const settings = await db.getSettings(workspaceId)
      if (!settings?.digestChannelId) return
      const weeklyKudos = await db.getWeeklyKudos(workspaceId, new Date())
      if (weeklyKudos.length === 0) return
      await aiService.configure(settings)
      const digest = await aiService.generateDigest(weeklyKudos.map((k) => ({ fromUser: k.fromUserName, toUser: k.toUserName, reason: k.reason, emoji: k.emoji })))
      await client.chat.postMessage({ channel: settings.digestChannelId, text: digest })
    } catch (error) { console.error('Workflow digest failed:', error) }
  })
}

// ── Kudos Board Builder ────────────────────────────────────────────
function buildKudosBoard(
  kudosList: Kudos[],
  _settings: unknown,
  totalCount: number,
  currentPage: number,
  sortOrder: 'latest' | 'oldest' | 'reactions' = 'latest',
  searchQuery: string = '',
  isAdmin: boolean = false,
  _userId: string = ''
): any[] {
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const blocks: any[] = []

  // Header
  blocks.push({ type: 'header', text: { type: 'plain_text', text: '🎉 Kudos Board' } })

  // Search + Sort row
  const actionElements: any[] = [
    { type: 'button', action_id: 'kudos_open_search', text: { type: 'plain_text', text: '🔍 Search' } },
  ]

  if (sortOrder === 'latest') {
    actionElements.push({ type: 'button', action_id: 'kudos_sort_latest', text: { type: 'plain_text', text: '📅 Latest First' } })
  } else if (sortOrder === 'oldest') {
    actionElements.push({ type: 'button', action_id: 'kudos_sort_oldest', text: { type: 'plain_text', text: '📅 Oldest First' } })
  } else {
    actionElements.push({ type: 'button', action_id: 'kudos_sort_reactions', text: { type: 'plain_text', text: '🔥 Most Reactions' } })
  }

  blocks.push({ type: 'actions', block_id: 'board_actions', elements: actionElements })

  if (searchQuery) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `🔍 *Search results for:* "${searchQuery}"` } })
  }

  blocks.push({ type: 'divider' })

  if (kudosList.length === 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: ':information_source: No kudos have been given yet. Use `/kudos @user reason` to get started!' } })
  } else {
    for (const kudo of kudosList) {
      const timeAgo = getTimeAgo(kudo.createdAt)
      const channelPart = kudo.channelName ? ` · #${kudo.channelName}` : ''

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${kudo.emoji} *<@${kudo.toUserId}>* from <@${kudo.fromUserId}> · ${timeAgo}${channelPart}\n_"${kudo.reason}"_`,
        },
      })

      // Reaction buttons row with counts
      const reactionElements: any[] = []
      const defaultReactions = [':tada:', ':heart:', ':clap:', ':rocket:', ':star:', ':fire:']

      for (const reaction of defaultReactions) {
        reactionElements.push({
          type: 'button',
          action_id: `react_${kudo.id}_${encodeURIComponent(reaction)}`,
          text: { type: 'plain_text', text: `${reaction}` },
          style: 'primary' as const,
        })
      }

      // Edit/Delete for authorized users
      if (isAdmin) {
        blocks.push({
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Reactions: ${reactionElements.length > 0 ? 'Click an emoji to react' : ''}` },
          ],
        })
        blocks.push({
          type: 'actions',
          block_id: `kudo_actions_${kudo.id}`,
          elements: [
            { type: 'button', action_id: `edit_kudos_${kudo.id}`, text: { type: 'plain_text', text: '✏️ Edit' } },
            { type: 'button', action_id: `delete_kudos_${kudo.id}`, text: { type: 'plain_text', text: '🗑️ Delete' }, style: 'danger' as const, confirm: { title: { type: 'plain_text', text: 'Confirm Delete' }, text: { type: 'plain_text', text: 'Are you sure you want to delete this kudos?' }, confirm: { type: 'plain_text', text: 'Delete' }, deny: { type: 'plain_text', text: 'Cancel' } } },
          ],
        })
      }
      blocks.push({ type: 'divider' })
    }

    // Pagination
    if (totalPages > 1) {
      const paginationElements: any[] = []
      if (currentPage > 1) {
        paginationElements.push({ type: 'button', action_id: `kudos_page_${currentPage - 1}`, text: { type: 'plain_text', text: '◀️ Previous' } })
      }
      paginationElements.push({ type: 'button', action_id: 'kudos_page_placeholder', text: { type: 'plain_text', text: `Page ${currentPage} of ${totalPages}` } })
      if (currentPage < totalPages) {
        paginationElements.push({ type: 'button', action_id: `kudos_page_${currentPage + 1}`, text: { type: 'plain_text', text: 'Next ▶️' } })
      }
      blocks.push({ type: 'actions', block_id: 'pagination', elements: paginationElements })
    }
  }

  // About section at the bottom
  blocks.push({ type: 'divider' })
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*About Kudos Digest*\n\nRecognize and appreciate your teammates with kudos! Use `/kudos @user reason` to give kudos, and generate weekly digests to celebrate wins together.\n\n*Commands:*\n• `/kudos @user reason :emoji:` — Give kudos to a teammate\n• `/kudos-export [start: mm-dd-yyyy] [end: mm-dd-yyyy] [#channel]` — Export to CSV\n• `/kudos-export-google [start: mm-dd-yyyy] [end: mm-dd-yyyy] [#channel]` — Export for Google Docs\n\n*Settings:*\n• Digest Channel — Where the weekly digest is posted\n• Digest Day/Hour — When the digest is posted (UTC)\n• AI Provider — Optional AI for creative digests\n• Digest Style — Simple (always available) or Creative (when AI is set up)\n\n*Use Cases:*\n• Recognize team achievements in real-time\n• Build a culture of appreciation\n• Track contributions over time with exports\n• Generate morale-boosting weekly summaries',
    },
  })
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*GitHub Repository*\n<https://github.com/ranka23/kudos_digest_for_slack|View source code, report issues, or contribute>',
    },
  })
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Support the Project* :heart:\nIf you find this app useful, consider supporting its development.',
    },
  })
  blocks.push({
    type: 'actions',
    block_id: 'footer_actions',
    elements: [
      { type: 'button', action_id: 'open_donate', text: { type: 'plain_text', text: '❤️ Donate $1' }, style: 'primary' as const },
      ...(isAdmin ? [
        { type: 'button', action_id: 'open_settings', text: { type: 'plain_text', text: '⚙️ Settings' } },
        { type: 'button', action_id: 'manual_digest', text: { type: 'plain_text', text: '📊 Generate Weekly Digest' } },
      ] : []),
    ],
  })

  return blocks
}

// ── Donate Modal ───────────────────────────────────────────────────
function buildDonateModal(): any[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '☕ *Buy me a Coffee!*\n\nYour donations help me build better software. We accept Ethereum, Solana, USDC and USDT.',
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      block_id: 'donate_eth_section',
      text: {
        type: 'mrkdwn',
        text: '*🔷 ETH (Ethereum)*\n`0x907DB6Ad294bD6B9adAE4C2340d34883E32F121A`',
      },
    },
    {
      type: 'image',
      title: { type: 'plain_text', text: 'ETH QR Code' },
      image_url: 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=ethereum:0x907DB6Ad294bD6B9adAE4C2340d34883E32F121A',
      alt_text: 'QR code for ETH wallet address',
    },
    { type: 'divider' },
    {
      type: 'section',
      block_id: 'donate_sol_section',
      text: {
        type: 'mrkdwn',
        text: '*🟣 SOL (Solana)*\n`H9kw2HG3eik5uKYoULHuzohoY7gCi1Jfqk38ppn1Szyo`',
      },
    },
    {
      type: 'image',
      title: { type: 'plain_text', text: 'SOL QR Code' },
      image_url: 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=solana:H9kw2HG3eik5uKYoULHuzohoY7gCi1Jfqk38ppn1Szyo',
      alt_text: 'QR code for SOL wallet address',
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*USDC / USDT* can be sent to the same addresses above on their respective networks.',
      },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: 'Open Source — <https://github.com/ranka23/kudos_digest_for_slack|Source Code>' },
      ],
    },
  ]
}

// ── Settings Modal ──────────────────────────────────────────────────
function buildSettingsModal(settings: {
  digestChannelId?: string | null; digestDay?: number; digestHour?: number; aiProvider?: string;
  aiApiKey?: string | null; aiModel?: string | null; aiBaseUrl?: string | null; digestStyle?: string; workflowTriggerId?: string | null;
} | null): Array<Record<string, unknown>> {
  return [
    { type: 'input', block_id: 'digest_channel_block', element: { type: 'conversations_select', action_id: 'digest_channel', placeholder: { type: 'plain_text', text: 'Select channel for weekly digest' }, default_to_current_conversation: false, filter: { include: ['public', 'private'] }, initial_conversation: settings?.digestChannelId ?? undefined }, label: { type: 'plain_text', text: 'Digest Channel' } },
    { type: 'input', block_id: 'digest_day_block', element: { type: 'static_select', action_id: 'digest_day', placeholder: { type: 'plain_text', text: 'Select day' }, options: [
      { text: { type: 'plain_text', text: 'Monday' }, value: '1' }, { text: { type: 'plain_text', text: 'Tuesday' }, value: '2' },
      { text: { type: 'plain_text', text: 'Wednesday' }, value: '3' }, { text: { type: 'plain_text', text: 'Thursday' }, value: '4' },
      { text: { type: 'plain_text', text: 'Friday' }, value: '5' }, { text: { type: 'plain_text', text: 'Saturday' }, value: '6' },
      { text: { type: 'plain_text', text: 'Sunday' }, value: '7' },
    ], initial_option: settings?.digestDay ? { text: { type: 'plain_text', text: getDayName(settings.digestDay) }, value: String(settings.digestDay) } : undefined }, label: { type: 'plain_text', text: 'Digest Day' } },
    { type: 'input', block_id: 'digest_hour_block', element: { type: 'static_select', action_id: 'digest_hour', placeholder: { type: 'plain_text', text: 'Select hour' }, options: Array.from({ length: 24 }, (_, i) => ({ text: { type: 'plain_text', text: `${i}:00` }, value: String(i) })), initial_option: settings?.digestHour !== undefined ? { text: { type: 'plain_text', text: `${settings.digestHour}:00` }, value: String(settings.digestHour) } : undefined }, label: { type: 'plain_text', text: 'Digest Hour (UTC)' } },
    { type: 'section', block_id: 'ai_provider_section', text: { type: 'mrkdwn', text: '*AI Configuration (Optional)*\nAdd an AI API key to generate creative weekly digests.' } },
    { type: 'input', block_id: 'ai_provider_block', optional: true, element: { type: 'static_select', action_id: 'ai_provider', placeholder: { type: 'plain_text', text: 'Select AI provider (optional)' }, options: [
      { text: { type: 'plain_text', text: 'None (Simple Digest)' }, value: 'none' }, { text: { type: 'plain_text', text: 'OpenAI' }, value: 'openai' },
      { text: { type: 'plain_text', text: 'Anthropic' }, value: 'anthropic' }, { text: { type: 'plain_text', text: 'Custom (OpenAI-compatible)' }, value: 'custom' },
    ], initial_option: settings?.aiProvider ? { text: { type: 'plain_text', text: getProviderName(settings.aiProvider) }, value: settings.aiProvider } : { text: { type: 'plain_text', text: 'None (Simple Digest)' }, value: 'none' } }, label: { type: 'plain_text', text: 'AI Provider' } },
    { type: 'input', block_id: 'ai_key_block', element: { type: 'plain_text_input', action_id: 'ai_key', placeholder: { type: 'plain_text', text: 'Enter your API key' }, initial_value: settings?.aiApiKey ?? undefined }, label: { type: 'plain_text', text: 'API Key', emoji: true }, optional: true },
    { type: 'input', block_id: 'ai_model_block', element: { type: 'plain_text_input', action_id: 'ai_model', placeholder: { type: 'plain_text', text: 'e.g., gpt-4o-mini' }, initial_value: settings?.aiModel ?? undefined }, label: { type: 'plain_text', text: 'Model Name', emoji: true }, optional: true },
    { type: 'input', block_id: 'ai_base_url_block', element: { type: 'plain_text_input', action_id: 'ai_base_url', placeholder: { type: 'plain_text', text: 'https://your-provider.com/v1' }, initial_value: settings?.aiBaseUrl ?? undefined }, label: { type: 'plain_text', text: 'Base URL (Custom Provider)', emoji: true }, optional: true },
    { type: 'input', block_id: 'digest_style_block', element: { type: 'static_select', action_id: 'digest_style', placeholder: { type: 'plain_text', text: 'Select style' }, options: (settings?.aiProvider && settings.aiProvider !== 'none') ? [{ text: { type: 'plain_text', text: 'Simple' }, value: 'simple' }, { text: { type: 'plain_text', text: 'Creative' }, value: 'creative' }] : [{ text: { type: 'plain_text', text: 'Simple' }, value: 'simple' }], initial_option: { text: { type: 'plain_text', text: 'Simple' }, value: 'simple' } }, label: { type: 'plain_text', text: 'Digest Style' } },
    { type: 'input', block_id: 'workflow_trigger_id_block', element: { type: 'plain_text_input', action_id: 'workflow_trigger_id', placeholder: { type: 'plain_text', text: 'Optional: Ft... (from Workflows trigger configuration)' }, initial_value: settings?.workflowTriggerId ?? undefined }, label: { type: 'plain_text', text: 'Workflow Trigger ID' }, optional: true, hint: { type: 'plain_text', text: 'Optional. Paste the trigger ID if using Slack Workflows.' } },
  ]
}

function getTimeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  return new Date(dateStr).toLocaleDateString()
}

function getDayName(day: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] ?? 'Friday'
}

function getProviderName(provider: string): string {
  const providers: Record<string, string> = { none: 'None (Simple Digest)', openai: 'OpenAI', anthropic: 'Anthropic', custom: 'Custom (OpenAI-compatible)' }
  return providers[provider] ?? 'None (Simple Digest)'
}