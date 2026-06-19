import { App } from '@slack/bolt'
import { db } from '../services/database'
import { aiService } from '../services/ai'
import { parseKudosCommand, generateKudosId, SUPPORTED_EMOJIS, formatKudosForGoogleDocs } from '../utils/helpers'
import type { Kudos } from '../types/index'

export async function getChannelIdFromName(teamId: string, channelName: string, client: { conversations: { list: (_params: { team_id: string; types?: string }) => Promise<unknown> }; info: (_params: { channel: string }) => Promise<unknown> } | null): Promise<string | null> {
  if (!client?.conversations?.list) return null

  try {
    const channelsResponse = await client.conversations.list({
      team_id: teamId,
      types: 'public_channel,private_channel,mpim,im'
    })
    const channels = (channelsResponse as { channels?: { id: string; name: string }[] }).channels ?? []
    const channel = channels.find((c) => c.name === channelName.toLowerCase())
    return channel?.id ?? null
  } catch (error) {
    return null
  }
}

async function isAuthorizedForKudos(userId: string, kudos: { fromUserId: string }, client: { users: { info: (_params: { user: string }) => Promise<unknown> } }): Promise<boolean> {
  if (kudos.fromUserId === userId) return true
  const result = await client.users.info({ user: userId })
  const user = result as { user?: { is_admin?: boolean } }
  return !!user.user?.is_admin
}

export function registerListeners(app: App): void {
  app.command('/kudos', async ({ command, ack, respond, client }) => {
    await ack()

    const workspaceId = command.team_id
    const { userIds, reason, emoji } = parseKudosCommand(command.text)
    let channelName = 'unknown'

    try {
      const channelInfo = await client.conversations.info({ channel: command.channel_id }).catch(() => null)
      channelName = channelInfo?.channel?.name ?? 'unknown'
    } catch {
      channelName = 'unknown'
    }

    try {
      for (const toUserId of userIds) {
        try {
          const userInfo = await client.users.info({ user: toUserId })
          const toUserName = userInfo.user?.real_name ?? userInfo.user?.name ?? toUserId

          const kudos: Kudos = {
            id: generateKudosId(),
            fromUserId: command.user_id,
            fromUserName: command.user_name,
            toUserId,
            toUserName,
            reason,
            emoji,
            channelId: command.channel_id,
            channelName,
            createdAt: new Date().toISOString(),
            workspaceId,
          }

          await db.createKudos(kudos)

          await respond({
            text: `:tada: Kudos given to <@${toUserId}> for: "${reason}"`,
            response_type: 'in_channel',
            replace_original: false,
          })
        } catch (error) {
          console.error(`Failed to create kudos for user ${toUserId}:`, error)
          await respond({
            text: `Failed to give kudos to <@${toUserId}>. They may not exist or the bot lacks permission.`,
            response_type: 'ephemeral',
          })
        }
      }

      await refreshHomeForUser(command.user_id, workspaceId).catch((error) => {
        console.error('Home refresh failed:', error)
      })
    } catch (error) {
      console.error('Slash command failed:', error)
      await respond({
        text: 'Something went wrong while creating kudos. Please try again.',
        response_type: 'ephemeral',
      })
    }
  })

    const startDate = parts[0] ?? ''
    const endDate = parts[1] ?? ''
    const channelName = parts[2] ?? ''

    if (!startDate || !endDate) {
      await respond({
        text: 'Usage: `/kudos-export YYYY-MM-DD YYYY-MM-DD [@channel_name]`\nExample: `/kudos-export 2024-01-01 2024-01-31`\nExample: `/kudos-export 2024-01-01 2024-01-31 @channel-name`',
        response_type: 'ephemeral',
      })
      return
    }

    try {
      const start = new Date(startDate).toISOString()
      const end = new Date(endDate).toISOString()

      let kudosList: Kudos[]
      if (channelName && channelName.startsWith('@')) {
        const channelId = await getChannelIdFromName(command.channel_id, channelName.replace(/^@/, ''), command.client)
        if (channelId) {
          kudosList = await db.getKudosByDateRangeAndChannel(workspaceId, start, end, channelId)
        } else {
          await respond({
            text: `Channel ${channelName} not found in the workspace.\nPlease ensure the channel exists and the app is a member. Use /kudos-export without a channel to see all channels.`,
            response_type: 'ephemeral',
          })
          return
        }
      } else {
        kudosList = await db.getKudosByDateRange(workspaceId, start, end)
      }

      if (kudosList.length === 0) {
        await respond({
          text: `No kudos found${channelName ? ` in channel ${channelName}` : ''} between ${startDate} and ${endDate}.`,
          response_type: 'ephemeral',
        })
        return
      }

      const exportData = kudosList.map((k) => ({
        fromUser: k.fromUserName,
        toUser: k.toUserName,
        reason: k.reason,
        emoji: k.emoji,
        channel: k.channelName ?? 'unknown',
        date: k.createdAt,
      }))

      const csv = kudosToCsv(exportData)

      await respond({
        text: `Here's your kudos export (${kudosList.length} entries):`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Here's your kudos export for ${startDate} to ${endDate}${channelName ? ` in channel ${channelName}` : ''}:`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '```' + csv + '```',
            },
          },
        ],
        response_type: 'ephemeral',
      })
    } catch (error) {
      console.error('Export failed:', error)
      await respond({
        text: 'Failed to export kudos. Please check the date format (YYYY-MM-DD).',
        response_type: 'ephemeral',
      })
    }
  })

  app.command('/kudos-export-google', async ({ command, ack, respond }) => {
    await ack()

    const workspaceId = command.team_id
    const parts = command.text.trim().split(/\s+/)

    const startDate = parts[0] ?? ''
    const endDate = parts[1] ?? ''
    const channelName = parts[2] ?? ''

    if (!startDate || !endDate) {
      await respond({
        text: 'Usage: `/kudos-export-google YYYY-MM-DD YYYY-MM-DD [@channel_name]`\nExample: `/kudos-export-google 2024-01-01 2024-01-31`\nExample: `/kudos-export-google 2024-01-01 2024-01-31 @channel-name`',
        response_type: 'ephemeral',
      })
      return
    }

    try {
      const start = new Date(startDate).toISOString()
      const end = new Date(endDate).toISOString()

      let kudosList: Kudos[]
      if (channelName && channelName.startsWith('@')) {
        const channelId = await getChannelIdFromName(command.channel_id, channelName.replace(/^@/, ''), command.client)
        if (channelId) {
          kudosList = await db.getKudosByDateRangeAndChannel(workspaceId, start, end, channelId)
        } else {
          await respond({
            text: `Channel ${channelName} not found in the workspace.\nPlease ensure the channel exists and the app is a member. Use /kudos-export-google without a channel to see all channels.`,
            response_type: 'ephemeral',
          })
          return
        }
      } else {
        kudosList = await db.getKudosByDateRange(workspaceId, start, end)
      }

      if (kudosList.length === 0) {
        await respond({
          text: `No kudos found${channelName ? ` in channel ${channelName}` : ''} between ${startDate} and ${endDate}.`,
          response_type: 'ephemeral',
        })
        return
      }

      const googleDocBlock = formatKudosForGoogleDocs(
        kudosList.map((k) => ({
          reason: k.reason,
          emoji: k.emoji,
          fromUserName: k.fromUserName,
          toUserName: k.toUserName,
        })),
        startDate,
        endDate
      )

      const csvBlock = kudosToCsv(
        kudosList.map((k) => ({
          fromUser: k.fromUserName,
          toUser: k.toUserName,
          reason: k.reason,
          emoji: k.emoji,
          channel: k.channelName ?? 'unknown',
          date: k.createdAt,
        }))
      )

      await respond({
        text: `Google export for ${startDate} to ${endDate}${channelName ? ` in channel ${channelName}` : ''}:`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Google Docs format (copy/paste this block):*',
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '```' + googleDocBlock + '```',
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Google Sheets format (copy/paste this CSV block):*',
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '```' + csvBlock + '```',
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '_Tip: Copy into Google Docs or Google Sheets manually._',
            },
          },
        ],
        response_type: 'ephemeral',
      })
    } catch (error) {
      console.error('Google export failed:', error)
      await respond({
        text: 'Failed to export kudos for Google. Please check the date format (YYYY-MM-DD).',
        response_type: 'ephemeral',
      })
    }
  })

  app.event('app_home_opened', async ({ event, client }) => {
    const workspaceId = (event as { team_id?: string }).team_id ?? ''

    try {
      const settings = await db.getSettings(workspaceId)
      const kudosList = await db.getKudosByWorkspace(workspaceId, 20)

      await client.views.publish({
        user_id: event.user,
        view: {
          type: 'home',
          callback_id: 'home_view',
          blocks: buildHomeView(kudosList, settings),
        },
      })
    } catch (error) {
      const err = error as { code?: string; data?: { error?: string } } | undefined
      if (err?.code === 'not_enabled' || err?.data?.error === 'not_enabled') {
        console.warn('Home tab not enabled; skipping home view publish.')
        return
      }
      console.error('Failed to publish home view:', error)
    }
  })

  app.event('workflow_run_executed', async ({ event, client }) => {
    const workflowEvent = event as {
      workflow?: { step?: { name?: string; inputs?: { workspace_id?: string } } }
      team?: string
    }
    const workspaceId = workflowEvent.workflow?.step?.inputs?.workspace_id ?? workflowEvent.team ?? ''

    if (!workspaceId) return

    try {
      const settings = await db.getSettings(workspaceId)

      if (!settings?.digestChannelId) return

      const weeklyKudos = await db.getWeeklyKudos(workspaceId, new Date())

      if (weeklyKudos.length === 0) return

      await aiService.configure(settings)

      const kudosData = weeklyKudos.map((k) => ({
        fromUser: k.fromUserName,
        toUser: k.toUserName,
        reason: k.reason,
        emoji: k.emoji,
      }))

      const digest = await aiService.generateDigest(kudosData)

      await client.chat.postMessage({
        channel: settings.digestChannelId,
        text: digest,
      })
    } catch (error) {
      console.error('Failed to generate workflow digest:', error)
    }
  })

  app.action('open_settings', async ({ ack, client, body }) => {
    await ack()

    const triggerId = (body as { trigger_id?: string }).trigger_id ?? ''
    const workspaceId = (body as { team?: { id?: string } }).team?.id ?? ''

    try {
      const settings = await db.getSettings(workspaceId)

      await client.views.open({
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: 'settings_modal',
          title: {
            type: 'plain_text',
            text: 'Kudos Digest Settings',
          },
          blocks: buildSettingsModal(settings) as any,
          submit: {
            type: 'plain_text',
            text: 'Save Settings',
          },
          close: {
            type: 'plain_text',
            text: 'Cancel',
          },
        },
      })
    } catch (error) {
      console.error('Failed to open settings modal:', error)
    }
  })

  app.view('settings_modal', async ({ ack, view, client, body }) => {
    await ack()

    const teamId = (body as { team?: { id?: string } }).team?.id ?? ''
    const state = view.state.values as Record<
      string,
      Record<
        string,
        { selected_conversation?: string; selected_option?: { value?: string }; value?: string }
      >
    >

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

    try {
      await client.chat.postMessage({
        channel: (body as { user?: { id?: string } }).user?.id ?? '',
        text: ':white_check_mark: Settings saved successfully!',
      })
    } catch (error) {
      console.error('Failed to send confirmation:', error)
    }

    await refreshHomeForUser((body as { user?: { id?: string } }).user?.id ?? '', teamId)
  })

  app.action(/^edit_kudos_/, async ({ body, ack, client }) => {
    await ack()

    const actingUserId = (body as { user?: { id?: string } }).user?.id
    const kudosId = String((body as { actions?: { action_id?: string }[] }).actions?.[0]?.action_id ?? '').replace('edit_kudos_', '')

    if (!actingUserId || !kudosId) return

    const kudos = await db.getKudosById(kudosId)
    if (!kudos) {
      await client.chat.postMessage({ channel: actingUserId, text: 'Kudos not found.' })
      return
    }

    const allowed = await isAuthorizedForKudos(actingUserId, kudos, client)
    if (!allowed) {
      await client.chat.postMessage({ channel: actingUserId, text: 'You are not allowed to edit this kudos.' })
      return
    }

    const triggerId = (body as { trigger_id?: string }).trigger_id ?? ''

    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: `edit_kudos_modal_${kudosId}`,
        title: {
          type: 'plain_text',
          text: 'Edit Kudos',
        },
        blocks: [
          {
            type: 'input',
            block_id: 'reason_block',
            element: {
              type: 'plain_text_input',
              action_id: 'reason',
              initial_value: kudos.reason,
            },
            label: {
              type: 'plain_text',
              text: 'Reason',
            },
            optional: false,
          },
          {
            type: 'input',
            block_id: 'emoji_block',
            element: {
              type: 'static_select',
              action_id: 'emoji',
              options: SUPPORTED_EMOJIS.map((emoji) => ({
                text: { type: 'plain_text', text: emoji },
                value: emoji,
              })),
              initial_option: { text: { type: 'plain_text', text: kudos.emoji }, value: kudos.emoji },
            },
            label: {
              type: 'plain_text',
              text: 'Emoji',
            },
            optional: false,
          },
        ],
        submit: {
          type: 'plain_text',
          text: 'Save',
        },
        close: {
          type: 'plain_text',
          text: 'Cancel',
        },
      },
    })
  })

  app.view(/^edit_kudos_modal_/, async ({ ack, view, body, client }) => {
    await ack()

    const match = /^edit_kudos_modal_(.+)$/.exec(view.callback_id)
    const kudosId = match?.[1] ?? ''
    const actingUserId = (body as { user?: { id?: string } }).user?.id ?? ''

    if (!kudosId || !actingUserId) return

    const kudos = await db.getKudosById(kudosId)
    if (!kudos) {
      await client.chat.postMessage({ channel: actingUserId, text: 'Kudos not found.' })
      return
    }

    const allowed = await isAuthorizedForKudos(actingUserId, kudos, client)
    if (!allowed) {
      await client.chat.postMessage({ channel: actingUserId, text: 'You are not allowed to edit this kudos.' })
      return
    }

    const values = view.state.values as Record<string, Record<string, { value?: string; selected_option?: { value?: string } }>>
    const reason = values.reason_block?.reason?.value ?? kudos.reason
    const emoji = values.emoji_block?.emoji?.selected_option?.value ?? kudos.emoji

    await db.updateKudos(kudosId, reason, emoji)

    await client.chat.postMessage({
      channel: actingUserId,
      text: ':white_check_mark: Kudos updated.',
    })

    if (kudos.fromUserId) {
      const teamId = (body as { team?: { id?: string } }).team?.id ?? ''
      await refreshHomeForUser(kudos.fromUserId, teamId)
    }
  })

  app.action(/^delete_kudos_/, async ({ body, ack, client }) => {
    await ack()

    const actingUserId = (body as { user?: { id?: string } }).user?.id
    const kudosId = String((body as { actions?: { action_id?: string }[] }).actions?.[0]?.action_id ?? '').replace('delete_kudos_', '')

    if (!actingUserId || !kudosId) return

    const kudos = await db.getKudosById(kudosId)
    if (!kudos) {
      await client.chat.postMessage({ channel: actingUserId, text: 'Kudos not found.' })
      return
    }

    const allowed = await isAuthorizedForKudos(actingUserId, kudos, client)
    if (!allowed) {
      await client.chat.postMessage({ channel: actingUserId, text: 'You are not allowed to delete this kudos.' })
      return
    }

    await db.deleteKudos(kudosId)

    await client.chat.postMessage({
      channel: actingUserId,
      text: ':white_check_mark: Kudos deleted.',
    })

    const teamId = (body as { team?: { id?: string } }).team?.id ?? ''
    if (kudos.fromUserId) {
      await refreshHomeForUser(kudos.fromUserId, teamId)
    }
  })

  app.action('manual_digest', async ({ ack, body, client }) => {
    await ack()

    const workspaceId = (body as { team?: { id?: string } }).team?.id ?? ''

    try {
      const settings = await db.getSettings(workspaceId)

      if (!settings?.digestChannelId) {
        await client.chat.postMessage({
          channel: (body as { user?: { id?: string } }).user?.id ?? '',
          text: 'No digest channel configured. Use the App Home to set up your digest channel.',
        })
        return
      }

      const weeklyKudos = await db.getWeeklyKudos(workspaceId, new Date())

      if (weeklyKudos.length === 0) {
        await client.chat.postMessage({
          channel: (body as { user?: { id?: string } }).user?.id ?? '',
          text: 'No kudos found for this week.',
        })
        return
      }

      await aiService.configure({
        aiProvider: settings.aiProvider ?? 'none',
        aiApiKey: settings.aiApiKey,
        aiModel: settings.aiModel,
        aiBaseUrl: settings.aiBaseUrl,
        digestStyle: settings.digestStyle,
      })

      const kudosData = weeklyKudos.map((k) => ({
        fromUser: k.fromUserName,
        toUser: k.toUserName,
        reason: k.reason,
        emoji: k.emoji,
      }))

      const digest = await aiService.generateDigest(kudosData)

      await client.chat.postMessage({
        channel: settings.digestChannelId,
        text: digest,
      })

      await client.chat.postMessage({
        channel: (body as { user?: { id?: string } }).user?.id ?? '',
        text: `:tada: Weekly digest posted to <#${settings.digestChannelId}>!`,
      })
    } catch (error) {
      console.error('Manual digest generation failed:', error)
      await client.chat.postMessage({
        channel: (body as { user?: { id?: string } }).user?.id ?? '',
        text: 'Failed to generate weekly digest.',
      })
    }
  })
}

function kudosToCsv(kudosList: { fromUser: string; toUser: string; reason: string; emoji: string; channel: string; date: string }[]): string {
  const header = 'From User,To User,Reason,Emoji,Channel,Date\n'
  const rows = kudosList
    .map((k) => {
      const needsQuotes = k.reason.includes(',') || k.reason.includes('"')
      const escapedReason = needsQuotes ? `"${k.reason.replace(/"/g, '""')}"` : k.reason
      return `${k.fromUser},${k.toUser},${escapedReason},${k.emoji},${k.channel},${k.date}`
    })
    .join('\n')

  return header + rows
}

function buildHomeView(
  kudosList: { toUserId?: string; toUserName: string; reason: string; emoji: string; createdAt: string }[],
  _settings: unknown
): any[] {
  const kudosBlocks: any[] = []

  if (kudosList.length === 0) {
    kudosBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':information_source: No kudos have been given yet. Use `/kudos @user reason` to get started!',
      },
    })
  } else {
    for (const kudo of kudosList) {
      kudosBlocks.push(
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${kudo.emoji} ${kudo.toUserName} - "${kudo.reason}"`,
          },
        },
        {
          type: 'actions',
          block_id: `kudos_actions_${kudo.createdAt}`,
          elements: [
            {
              type: 'button',
              action_id: `edit_kudos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              text: {
                type: 'plain_text',
                text: 'Edit',
              },
            },
            {
              type: 'button',
              action_id: `delete_kudos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              text: {
                type: 'plain_text',
                text: 'Delete',
              },
              style: 'danger',
              confirm: {
                title: {
                  type: 'plain_text',
                  text: 'Confirm Delete',
                },
                text: {
                  type: 'plain_text',
                  text: 'Are you sure you want to delete this kudos?',
                },
                confirm: {
                  type: 'plain_text',
                  text: 'Delete',
                },
                deny: {
                  type: 'plain_text',
                  text: 'Cancel',
                },
              },
            },
          ],
        }
      )
    }
  }

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Kudos Digest :tada:',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Give recognition to your teammates with `/kudos @user reason`',
      },
    },
    {
      type: 'divider',
    },
    ...kudosBlocks,
    {
      type: 'divider',
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: 'open_settings',
          text: {
            type: 'plain_text',
            text: 'Settings',
          },
        },
        {
          type: 'button',
          action_id: 'manual_digest',
          text: {
            type: 'plain_text',
            text: 'Generate Weekly Digest',
          },
        },
      ],
    },
  ]
}

function buildSettingsModal(settings: {
  digestChannelId?: string | null
  digestDay?: number
  digestHour?: number
  aiProvider?: string
  aiApiKey?: string | null
  aiModel?: string | null
  aiBaseUrl?: string | null
  digestStyle?: string
  workflowTriggerId?: string | null
} | null): Array<Record<string, unknown>> {
  return [
    {
      type: 'input',
      block_id: 'digest_channel_block',
      element: {
        type: 'conversations_select',
        action_id: 'digest_channel',
        placeholder: {
          type: 'plain_text',
          text: 'Select channel for weekly digest',
        },
        default_to_current_conversation: false,
        filter: {
          include: ['public_channels', 'private_channels'],
        },
        initial_conversation: settings?.digestChannelId ?? undefined,
      },
      label: {
        type: 'plain_text',
        text: 'Digest Channel',
      },
    },
    {
      type: 'input',
      block_id: 'digest_day_block',
      element: {
        type: 'static_select',
        action_id: 'digest_day',
        placeholder: {
          type: 'plain_text',
          text: 'Select day',
        },
        options: [
          { label: { type: 'plain_text', text: 'Monday' }, value: '1' },
          { label: { type: 'plain_text', text: 'Tuesday' }, value: '2' },
          { label: { type: 'plain_text', text: 'Wednesday' }, value: '3' },
          { label: { type: 'plain_text', text: 'Thursday' }, value: '4' },
          { label: { type: 'plain_text', text: 'Friday' }, value: '5' },
          { label: { type: 'plain_text', text: 'Saturday' }, value: '6' },
          { label: { type: 'plain_text', text: 'Sunday' }, value: '7' },
        ],
        initial_option: settings?.digestDay
          ? {
              label: { type: 'plain_text', text: getDayName(settings.digestDay) },
              value: String(settings.digestDay),
            }
          : undefined,
      },
      label: {
        type: 'plain_text',
        text: 'Digest Day',
      },
    },
    {
      type: 'input',
      block_id: 'digest_hour_block',
      element: {
        type: 'static_select',
        action_id: 'digest_hour',
        placeholder: {
          type: 'plain_text',
          text: 'Select hour',
        },
        options: Array.from({ length: 24 }, (_, i) => ({
          label: { type: 'plain_text', text: `${i}:00` },
          value: String(i),
        })),
        initial_option: settings?.digestHour !== undefined
          ? { label: { type: 'plain_text', text: `${settings.digestHour}:00` }, value: String(settings.digestHour) }
          : undefined,
      },
      label: {
        type: 'plain_text',
        text: 'Digest Hour (UTC)',
      },
    },
    {
      type: 'section',
      block_id: 'ai_provider_section',
      text: {
        type: 'mrkdwn',
        text: '*AI Configuration (Optional)*\nAdd an AI API key to generate creative weekly digests.',
      },
    },
    {
      type: 'input',
      block_id: 'ai_provider_block',
      element: {
        type: 'static_select',
        action_id: 'ai_provider',
        placeholder: {
          type: 'plain_text',
          text: 'Select AI provider',
        },
        options: [
          { label: { type: 'plain_text', text: 'None (Simple Digest)' }, value: 'none' },
          { label: { type: 'plain_text', text: 'OpenAI' }, value: 'openai' },
          { label: { type: 'plain_text', text: 'Anthropic' }, value: 'anthropic' },
          { label: { type: 'plain_text', text: 'Custom (OpenAI-compatible)' }, value: 'custom' },
        ],
        initial_option: settings?.aiProvider
          ? { label: { type: 'plain_text', text: getProviderName(settings.aiProvider) }, value: settings.aiProvider }
          : undefined,
      },
      label: {
        type: 'plain_text',
        text: 'AI Provider',
      },
    },
    {
      type: 'input',
      block_id: 'ai_key_block',
      element: {
        type: 'plain_text_input',
        action_id: 'ai_key',
        placeholder: {
          type: 'plain_text',
          text: 'Enter your API key',
        },
        initial_value: settings?.aiApiKey ?? undefined,
      },
      label: {
        type: 'plain_text',
        text: 'API Key',
        emoji: true,
      },
      optional: true,
    },
    {
      type: 'input',
      block_id: 'ai_model_block',
      element: {
        type: 'plain_text_input',
        action_id: 'ai_model',
        placeholder: {
          type: 'plain_text',
          text: 'e.g., gpt-4o-mini',
        },
        initial_value: settings?.aiModel ?? undefined,
      },
      label: {
        type: 'plain_text',
        text: 'Model Name',
        emoji: true,
      },
      optional: true,
    },
    {
      type: 'input',
      block_id: 'ai_base_url_block',
      element: {
        type: 'plain_text_input',
        action_id: 'ai_base_url',
        placeholder: {
          type: 'plain_text',
          text: 'https://your-provider.com/v1',
        },
        initial_value: settings?.aiBaseUrl ?? undefined,
      },
      label: {
        type: 'plain_text',
        text: 'Base URL (Custom Provider)',
        emoji: true,
      },
      optional: true,
    },
    {
      type: 'input',
      block_id: 'digest_style_block',
      element: {
        type: 'static_select',
        action_id: 'digest_style',
        placeholder: {
          type: 'plain_text',
          text: 'Select style',
        },
        options: [
          { label: { type: 'plain_text', text: 'Simple' }, value: 'simple' },
          { label: { type: 'plain_text', text: 'Creative' }, value: 'creative' },
        ],
        initial_option: settings?.digestStyle
          ? { label: { type: 'plain_text', text: settings.digestStyle === 'creative' ? 'Creative' : 'Simple' }, value: settings.digestStyle }
          : undefined,
      },
      label: {
        type: 'plain_text',
        text: 'Digest Style',
      },
    },
    {
      type: 'input',
      block_id: 'workflow_trigger_id_block',
      element: {
        type: 'plain_text_input',
        action_id: 'workflow_trigger_id',
        placeholder: {
          type: 'plain_text',
          text: 'Optional: Ft... (from Workflows trigger configuration)',
        },
        initial_value: settings?.workflowTriggerId ?? undefined,
      },
      label: {
        type: 'plain_text',
        text: 'Workflow Trigger ID',
      },
      optional: true,
      hint: {
        type: 'plain_text',
        text: 'Optional. Paste the trigger ID if using Slack Workflows.',
      },
    },
  ]
}

function getDayName(day: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return days[day] ?? 'Friday'
}

function getProviderName(provider: string): string {
  const providers: Record<string, string> = {
    none: 'None (Simple Digest)',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    custom: 'Custom (OpenAI-compatible)',
  }
  return providers[provider] ?? 'None (Simple Digest)'
}
