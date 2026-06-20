import type { Kudos } from '../types/index'

// Default emoji for kudos
const DEFAULT_EMOJI = ':tada:'

// Supported emojis for kudos
export const SUPPORTED_EMOJIS = [
  ':tada:',
  ':star:',
  ':clap:',
  ':heart:',
  ':rocket:',
  ':sparkles:',
  ':trophy:',
  ':thumbsup:',
  ':fire:',
  ':smile:',
] as const

/**
 * Parses the /kudos slash command text and extracts user mentions and reason.
 * Supports format: @user1 @user2 reason text :emoji:
 *
 * @param text - The raw command text after /kudos
 * @returns Object containing arrays of user IDs and the reason string
 */
export function parseKudosCommand(text: string): {
  userIds: string[]
  reason: string
  emoji: string
} {
  const parts = text.trim().split(/\s+/)
  const userIds: string[] = []
  const reasonParts: string[] = []
  let emoji = DEFAULT_EMOJI

  for (const part of parts) {
    const mentionMatch = part.match(/^<@([A-Za-z0-9]+)(?:\|[^>]*)?>$/i) || part.match(/^@([A-Za-z0-9][A-Za-z0-9._-]*)$/i)
    const emojiMatch = part.match(/^:(.+):$/)

    if (mentionMatch) {
      userIds.push(mentionMatch[1])
    } else if (emojiMatch && SUPPORTED_EMOJIS.includes(part as typeof SUPPORTED_EMOJIS[number])) {
      emoji = part
    } else if (part.length > 0) {
      reasonParts.push(part)
    }
  }

  return {
    userIds,
    reason: reasonParts.join(' '),
    emoji,
  }
}

/**
 * Generates a unique ID for a kudos entry
 *
 * @returns A unique string ID
 */
export function generateKudosId(): string {
  return `kudos_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Formats a kudos entry for display in Slack messages
 *
 * @param kudo - The kudos entry to format
 * @returns Formatted markdown string
 */
export function formatKudoForDisplay(kudo: Kudos): string {
  const date = new Date(kudo.createdAt).toLocaleDateString()
  return `• ${kudo.emoji} <@${kudo.toUserId}> - "${kudo.reason}" _from_ <@${kudo.fromUserId}> (${date})`
}

/**
 * Validates the kudos command input
 *
 * @param userIds - Array of user IDs to validate
 * @param reason - The reason text to validate
 * @returns Error message if validation fails, null if valid
 */
export function validateKudosInput(userIds: string[], reason: string): string | null {
  if (userIds.length === 0) {
    return 'Please mention at least one user to give kudos to. Usage: `/kudos @user reason`'
  }

  if (reason.length === 0) {
    return 'Please provide a reason for the kudos. Usage: `/kudos @user reason`'
  }

  if (reason.length > 500) {
    return 'Kudos reason cannot exceed 500 characters.'
  }

  return null
}

/**
 * Converts kudos data to CSV format
 *
 * @param kudosList - Array of kudos to convert
 * @returns CSV string
 */
export function kudosToCsv(kudosList: { fromUser: string; toUser: string; reason: string; emoji: string; channel: string; date: string }[]): string {
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

/**
 * Gets the ISO date range for a week
 *
 * @param referenceDate - The date to calculate from (defaults to now)
 * @returns Object with startDate and endDate strings
 */
export function getWeekDateRange(referenceDate: Date = new Date()): {
  startDate: string
  endDate: string
} {
  const startOfWeek = new Date(referenceDate)
  const day = startOfWeek.getUTCDay()
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - day + 1)
  startOfWeek.setUTCHours(0, 0, 0, 0)

  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6)
  endOfWeek.setUTCHours(23, 59, 59, 999)

  return {
    startDate: startOfWeek.toISOString(),
    endDate: endOfWeek.toISOString(),
  }
}

/**
 * Formats a date for display in Slack
 *
 * @param date - Date string or Date object
 * @returns Formatted date string
 */
export function formatDateForDisplay(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Parses a date string in mm-dd-yyyy format and returns a Date object.
 * Returns null if the input is invalid.
 */
export function parseDateMMDDYYYY(dateStr: string): Date | null {
  if (!dateStr) return null
  const parts = dateStr.trim().split('-')
  if (parts.length !== 3) return null
  const month = parseInt(parts[0], 10)
  const day = parseInt(parts[1], 10)
  const year = parseInt(parts[2], 10)
  if (isNaN(month) || isNaN(day) || isNaN(year)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000) return null
  return new Date(year, month - 1, day)
}

export function formatKudosForGoogleDocs(
  kudosList: { reason: string; emoji: string; fromUserName: string; toUserName: string }[],
  startDate: string,
  endDate: string
): string {
  const grouped = new Map<string, typeof kudosList>()
  for (const k of kudosList) {
    const key = k.toUserName
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(k)
  }

  const formatRecipient = (name: string, entries: typeof kudosList) => {
    const header = `Title: Kudos to ${name}\n`
    const blocks = entries
      .map((k) => {
        return `"${k.reason}" ${k.emoji}\nfrom ${k.fromUserName}`
      })
      .join('\n\n')
    return header + blocks
  }

  return [
    `Kudos from ${startDate} to ${endDate}`,
    ...Array.from(grouped.entries()).map(([name, entries]) => formatRecipient(name, entries)),
  ].join('\n\n')
}