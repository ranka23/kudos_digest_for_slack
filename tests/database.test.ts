import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'node:sqlite'
import DatabaseService from '../src/services/database'
import type { Kudos, Settings } from '../src/types'

describe('DatabaseService', () => {
  let db: DatabaseService
  const dbPath = ':memory:'

  beforeEach(() => {
    db = new DatabaseService()
    return db.initialize(dbPath)
  })

  describe('initialize', () => {
    it('initializes without errors', async () => {
      await expect(db.initialize(dbPath)).resolves.toBeUndefined()
    })
  })

  describe('createKudos', () => {
    it('creates a kudos entry', async () => {
      const kudos: Kudos = {
        id: 'kudos_1',
        fromUserId: 'U123',
        fromUserName: 'Alice',
        toUserId: 'U456',
        toUserName: 'Bob',
        reason: 'Great work!',
        emoji: ':star:',
        channelId: 'C789',
        channelName: 'general',
        createdAt: '2024-06-15T12:00:00.000Z',
        workspaceId: 'T101',
      }

      await db.createKudos(kudos)
      const result = await db.getKudosById(kudos.id)
      expect(result).toBeDefined()
      expect(result!.id).toBe(kudos.id)
      expect(result!.fromUserId).toBe('U123')
      expect(result!.toUserId).toBe('U456')
      expect(result!.reason).toBe('Great work!')
      expect(result!.emoji).toBe(':star:')
    })
  })

  describe('getKudosById', () => {
    it('returns null for non-existent kudos', async () => {
      const result = await db.getKudosById('nonexistent')
      expect(result).toBeNull()
    })

    it('retrieves existing kudos', async () => {
      const kudos: Kudos = {
        id: 'kudos_1',
        fromUserId: 'U123',
        fromUserName: 'Alice',
        toUserId: 'U456',
        toUserName: 'Bob',
        reason: 'Great work!',
        emoji: ':star:',
        channelId: 'C789',
        channelName: 'general',
        createdAt: '2024-06-15T12:00:00.000Z',
        workspaceId: 'T101',
      }
      await db.createKudos(kudos)
      const result = await db.getKudosById('kudos_1')
      expect(result).toBeDefined()
      expect(result!.toUserId).toBe('U456')
    })
  })

  describe('getKudosByWorkspace', () => {
    it('returns kudos for a workspace', async () => {
      const kudos: Kudos = {
        id: 'kudos_1',
        fromUserId: 'U123',
        fromUserName: 'Alice',
        toUserId: 'U456',
        toUserName: 'Bob',
        reason: 'Great work!',
        emoji: ':star:',
        channelId: 'C789',
        channelName: 'general',
        createdAt: '2024-06-15T12:00:00.000Z',
        workspaceId: 'T101',
      }
      await db.createKudos(kudos)

      const result = await db.getKudosByWorkspace('T101', 10)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('kudos_1')
    })

    it('limits results when specified', async () => {
      const workspaceId = 'T101'
      for (let i = 0; i < 5; i++) {
        await db.createKudos({
          id: `kudos_${i}`,
          fromUserId: 'U123',
          fromUserName: 'Alice',
          toUserId: `U${i}`,
          toUserName: `User${i}`,
          reason: `Reason ${i}`,
          emoji: ':star:',
          channelId: 'C789',
          channelName: 'general',
          createdAt: new Date(Date.now() + i * 1000).toISOString(),
          workspaceId,
        })
      }

      const result = await db.getKudosByWorkspace(workspaceId, 3)
      expect(result.length).toBeLessThanOrEqual(3)
    })

    it('returns empty array for workspace with no kudos', async () => {
      const result = await db.getKudosByWorkspace('EMPTY', 10)
      expect(result).toEqual([])
    })
  })

  describe('getKudosByDateRange', () => {
    beforeEach(async () => {
      await db.createKudos({
        id: 'kudos_1',
        fromUserId: 'U123',
        fromUserName: 'Alice',
        toUserId: 'U456',
        toUserName: 'Bob',
        reason: 'Old kudos',
        emoji: ':star:',
        channelId: 'C789',
        channelName: 'general',
        createdAt: '2024-01-15T12:00:00.000Z',
        workspaceId: 'T101',
      })
      await db.createKudos({
        id: 'kudos_2',
        fromUserId: 'U123',
        fromUserName: 'Alice',
        toUserId: 'U789',
        toUserName: 'Charlie',
        reason: 'Recent kudos',
        emoji: ':tada:',
        channelId: 'C789',
        channelName: 'general',
        createdAt: '2024-06-15T12:00:00.000Z',
        workspaceId: 'T101',
      })
    })

    it('returns kudos within date range', async () => {
      const start = new Date('2024-06-01').toISOString()
      const end = new Date('2024-06-30').toISOString()
      const result = await db.getKudosByDateRange('T101', start, end)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].id).toBe('kudos_2')
    })

    it('returns empty array when no kudos in range', async () => {
      const start = new Date('2023-01-01').toISOString()
      const end = new Date('2023-01-31').toISOString()
      const result = await db.getKudosByDateRange('T101', start, end)
      expect(result).toEqual([])
    })
  })

  describe('updateKudos', () => {
    it('updates kudos fields', async () => {
      const kudos: Kudos = {
        id: 'kudos_1',
        fromUserId: 'U123',
        fromUserName: 'Alice',
        toUserId: 'U456',
        toUserName: 'Bob',
        reason: 'Original reason',
        emoji: ':star:',
        channelId: 'C789',
        channelName: 'general',
        createdAt: '2024-06-15T12:00:00.000Z',
        workspaceId: 'T101',
      }
      await db.createKudos(kudos)

      await db.updateKudos('kudos_1', 'Updated reason', ':heart:')

      const result = await db.getKudosById('kudos_1')
      expect(result!.reason).toBe('Updated reason')
      expect(result!.emoji).toBe(':heart:')
    })
  })

  describe('deleteKudos', () => {
    it('removes kudos entry', async () => {
      const kudos: Kudos = {
        id: 'kudos_1',
        fromUserId: 'U123',
        fromUserName: 'Alice',
        toUserId: 'U456',
        toUserName: 'Bob',
        reason: 'Great work!',
        emoji: ':star:',
        channelId: 'C789',
        channelName: 'general',
        createdAt: '2024-06-15T12:00:00.000Z',
        workspaceId: 'T101',
      }
      await db.createKudos(kudos)

      await db.deleteKudos('kudos_1')

      const result = await db.getKudosById('kudos_1')
      expect(result).toBeNull()
    })
  })

  describe('Settings', () => {
    it('saves and retrieves settings', async () => {
      const settings: Settings = {
        workspaceId: 'T101',
        digestChannelId: 'C123',
        digestDay: 5,
        digestHour: 17,
        digestMinute: 0,
        aiProvider: 'none',
        aiApiKey: null,
        aiModel: null,
        aiBaseUrl: null,
        digestStyle: 'simple',
        workflowTriggerId: null,
        digestPostAt: null,
        createdAt: '2024-06-15T12:00:00.000Z',
        updatedAt: '2024-06-15T12:00:00.000Z',
      }

      await db.saveSettings(settings)
      const result = await db.getSettings('T101')

      expect(result).toBeDefined()
      expect(result!.digestChannelId).toBe('C123')
      expect(result!.digestDay).toBe(5)
    })

    it('returns null for non-existent settings', async () => {
      const result = await db.getSettings('NONEXISTENT')
      expect(result).toBeNull()
    })

    it('upserts settings when called twice', async () => {
      const settings1: Settings = {
        workspaceId: 'T101',
        digestChannelId: 'C123',
        digestDay: 5,
        digestHour: 17,
        digestMinute: 0,
        aiProvider: 'openai',
        aiApiKey: 'sk-test',
        aiModel: 'gpt-4',
        aiBaseUrl: null,
        digestStyle: 'creative',
        workflowTriggerId: null,
        digestPostAt: null,
        createdAt: '2024-06-15T12:00:00.000Z',
        updatedAt: '2024-06-15T12:00:00.000Z',
      }

      await db.saveSettings(settings1)

      const updated: Settings = {
        workspaceId: 'T101',
        digestChannelId: 'C456',
        digestDay: 1,
        digestHour: 9,
        digestMinute: 0,
        aiProvider: 'none',
        aiApiKey: null,
        aiModel: null,
        aiBaseUrl: null,
        digestStyle: 'simple',
        workflowTriggerId: null,
        digestPostAt: null,
        createdAt: '2024-06-15T12:00:00.000Z',
        updatedAt: '2024-06-16T12:00:00.000Z',
      }
      await db.saveSettings(updated)

      const result = await db.getSettings('T101')
      expect(result!.digestChannelId).toBe('C456')
      expect(result!.digestDay).toBe(1)
      expect(result!.digestHour).toBe(9)
    })
  })

  describe('getWeeklyKudos', () => {
    beforeEach(async () => {
      await db.createKudos({
        id: 'kudos_1',
        fromUserId: 'U123',
        fromUserName: 'Alice',
        toUserId: 'U456',
        toUserName: 'Bob',
        reason: 'Last week',
        emoji: ':star:',
        channelId: 'C789',
        channelName: 'general',
        createdAt: '2024-06-10T12:00:00.000Z',
        workspaceId: 'T101',
      })
      await db.createKudos({
        id: 'kudos_2',
        fromUserId: 'U123',
        fromUserName: 'Alice',
        toUserId: 'U789',
        toUserName: 'Charlie',
        reason: 'This week',
        emoji: ':tada:',
        channelId: 'C789',
        channelName: 'general',
        createdAt: '2024-06-12T12:00:00.000Z',
        workspaceId: 'T101',
      })
    })

    it('returns kudos for the week containing the given date', async () => {
      const date = new Date('2024-06-12T12:00:00.000Z')
      const weekly = await db.getWeeklyKudos('T101', date)

      expect(weekly.length).toBeGreaterThanOrEqual(1)
      const ids = weekly.map((k) => k.id)
      expect(ids).toContain('kudos_2')
    })
  })
})
