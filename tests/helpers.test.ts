import { describe, it, expect } from 'vitest'
import {
  parseKudosCommand,
  validateKudosInput,
  generateKudosId,
  formatDateForDisplay,
  getWeekDateRange,
  formatKudosForGoogleDocs,
  kudosToCsv,
  SUPPORTED_EMOJIS,
} from '../src/utils/helpers'

describe('parseKudosCommand', () => {
  it('parses single user with reason and emoji', () => {
    const result = parseKudosCommand('<@U123> Great work :star:')
    expect(result.userIds).toEqual(['U123'])
    expect(result.reason).toBe('Great work')
    expect(result.emoji).toBe(':star:')
  })

  it('parses multiple users with reason', () => {
    const result = parseKudosCommand('<@U123> <@U456> Thanks for teamwork')
    expect(result.userIds).toEqual(['U123', 'U456'])
    expect(result.reason).toBe('Thanks for teamwork')
    expect(result.emoji).toBe(':tada:')
  })

  it('extracts username mention format', () => {
    const result = parseKudosCommand('<@U123|username> Amazing job :trophy:')
    expect(result.userIds).toEqual(['U123'])
    expect(result.reason).toBe('Amazing job')
    expect(result.emoji).toBe(':trophy:')
  })

  it('returns default emoji when none provided', () => {
    const result = parseKudosCommand('<@U123> Nice work')
    expect(result.emoji).toBe(':tada:')
  })

  it('ignores invalid emoji', () => {
    const result = parseKudosCommand('<@U123> Nice work :invalid:')
    expect(result.emoji).toBe(':tada:')
  })

  it('parses @username format from slash commands', () => {
    const result = parseKudosCommand('@username Great work!')
    expect(result.userIds).toEqual(['username'])
    expect(result.reason).toBe('Great work!')
    expect(result.emoji).toBe(':tada:')
  })

  it('parses @username with dots and hyphens', () => {
    const result = parseKudosCommand('@john.doe @jane_doe Thanks!')
    expect(result.userIds).toEqual(['john.doe', 'jane_doe'])
    expect(result.reason).toBe('Thanks!')
    expect(result.emoji).toBe(':tada:')
  })

  it('handles empty text', () => {
    const result = parseKudosCommand('')
    expect(result.userIds).toEqual([])
    expect(result.reason).toBe('')
    expect(result.emoji).toBe(':tada:')
  })
})

describe('validateKudosInput', () => {
  it('returns null for valid input', () => {
    expect(validateKudosInput(['U123'], 'Great work')).toBeNull()
  })

  it('returns error when no users mentioned', () => {
    expect(validateKudosInput([], 'Great work')).toBeTruthy()
  })

  it('returns error when no reason provided', () => {
    expect(validateKudosInput(['U123'], '')).toBeTruthy()
  })

  it('returns error when reason exceeds 500 characters', () => {
    const longReason = 'a'.repeat(501)
    expect(validateKudosInput(['U123'], longReason)).toBeTruthy()
  })

  it('allows reason exactly 500 characters', () => {
    const maxReason = 'a'.repeat(500)
    expect(validateKudosInput(['U123'], maxReason)).toBeNull()
  })
})

describe('generateKudosId', () => {
  it('generates unique IDs', () => {
    const id1 = generateKudosId()
    const id2 = generateKudosId()
    expect(id1).not.toBe(id2)
    expect(id1.startsWith('kudos_')).toBe(true)
  })
})

describe('formatDateForDisplay', () => {
  it('formats date string correctly', () => {
    const date = '2024-06-15T12:00:00.000Z'
    const formatted = formatDateForDisplay(date)
    expect(formatted).toContain('2024')
  })

  it('formats Date object correctly', () => {
    const date = new Date('2024-06-15')
    const formatted = formatDateForDisplay(date)
    expect(formatted).toContain('2024')
  })
})

describe('getWeekDateRange', () => {
  it('returns ISO date strings', () => {
    const range = getWeekDateRange(new Date('2024-06-15'))
    expect(range.startDate).toBeTruthy()
    expect(range.endDate).toBeTruthy()
    expect(range.startDate).toContain('2024')
  })
})

describe('formatKudosForGoogleDocs', () => {
  it('formats kudos grouped by recipient', () => {
    const kudosList = [
      { fromUserName: 'Alice', toUserName: 'Bob', reason: 'Great work', emoji: ':star:' },
      { fromUserName: 'Charlie', toUserName: 'Bob', reason: 'Thanks', emoji: ':tada:' },
      { fromUserName: 'Alice', toUserName: 'Charlie', reason: 'Helpful', emoji: ':heart:' },
    ]

    const result = formatKudosForGoogleDocs(kudosList, '2024-06-01', '2024-06-30')

    expect(result).toContain('Kudos to Bob')
    expect(result).toContain('Kudos to Charlie')
    expect(result).toContain('Great work')
    expect(result).toContain('Thanks')
  })
})

describe('kudosToCsv', () => {
  it('generates valid CSV with header', () => {
    const kudosList = [
      { fromUser: 'Alice', toUser: 'Bob', reason: 'Great work', emoji: ':star:', channel: 'general', date: '2024-06-01' },
    ]

    const csv = kudosToCsv(kudosList)
    const lines = csv.split('\n')

    expect(lines[0]).toBe('From User,To User,Reason,Emoji,Channel,Date')
    expect(lines[1]).toBe('Alice,Bob,Great work,:star:,general,2024-06-01')
  })

  it('escapes commas and quotes in reason', () => {
    const kudosList = [
      { fromUser: 'Alice', toUser: 'Bob', reason: 'Great "teamwork"', emoji: ':star:', channel: 'general', date: '2024-06-01' },
    ]

    const csv = kudosToCsv(kudosList)
    const lines = csv.split('\n')

    expect(lines[1]).toBe('Alice,Bob,"Great ""teamwork""",:star:,general,2024-06-01')
  })
})

describe('SUPPORTED_EMOJIS', () => {
  it('contains expected emojis', () => {
    expect(SUPPORTED_EMOJIS).toContain(':tada:')
    expect(SUPPORTED_EMOJIS).toContain(':star:')
    expect(SUPPORTED_EMOJIS).toContain(':heart:')
    expect(SUPPORTED_EMOJIS.length).toBeGreaterThan(5)
  })
})
