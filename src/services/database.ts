import type { Kudos, Settings } from '../types/index'
import { DatabaseSync } from 'node:sqlite'

class DatabaseService {
  private db: DatabaseSync | null = null

  async initialize(dbPath: string = './kudos.db'): Promise<void> {
    this.db = new DatabaseSync(dbPath, { open: true })

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kudos (
        id TEXT PRIMARY KEY,
        fromUserId TEXT NOT NULL,
        fromUserName TEXT NOT NULL,
        toUserId TEXT NOT NULL,
        toUserName TEXT NOT NULL,
        reason TEXT NOT NULL,
        emoji TEXT DEFAULT ':tada:',
        channelId TEXT NOT NULL,
        channelName TEXT,
        createdAt TEXT NOT NULL,
        workspaceId TEXT NOT NULL
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        workspaceId TEXT PRIMARY KEY,
        digestChannelId TEXT,
        digestDay INTEGER DEFAULT 5,
        digestHour INTEGER DEFAULT 17,
        digestMinute INTEGER DEFAULT 0,
        aiProvider TEXT DEFAULT 'none',
        aiApiKey TEXT,
        aiModel TEXT,
        aiBaseUrl TEXT,
        digestStyle TEXT DEFAULT 'simple',
        workflowTriggerId TEXT,
        digestPostAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `)

    try {
      this.db.exec(`ALTER TABLE settings ADD COLUMN workflowTriggerId TEXT`)
    } catch {
      // column may already exist
    }
    try {
      this.db.exec(`ALTER TABLE settings ADD COLUMN digestPostAt TEXT`)
    } catch {
      // column may already exist
    }
  }

  async createKudos(kudos: Kudos): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(
      `INSERT INTO kudos (id, fromUserId, fromUserName, toUserId, toUserName, reason, emoji, channelId, channelName, createdAt, workspaceId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    stmt.run(
      kudos.id,
      kudos.fromUserId,
      kudos.fromUserName,
      kudos.toUserId,
      kudos.toUserName,
      kudos.reason,
      kudos.emoji,
      kudos.channelId,
      kudos.channelName,
      kudos.createdAt,
      kudos.workspaceId
    )
  }

  async getKudosByWorkspace(workspaceId: string, limit: number = 100): Promise<Kudos[]> {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM kudos WHERE workspaceId = ? ORDER BY createdAt DESC LIMIT ?')
    const rows = stmt.all(workspaceId, limit) as unknown as Kudos[]
    return rows
  }

  async getKudosByDateRange(workspaceId: string, startDate: string, endDate: string): Promise<Kudos[]> {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(
      'SELECT * FROM kudos WHERE workspaceId = ? AND createdAt >= ? AND createdAt <= ? ORDER BY createdAt DESC'
    )
    const rows = stmt.all(workspaceId, startDate, endDate) as unknown as Kudos[]
    return rows
  }

  async getKudosByDateRangeAndChannel(workspaceId: string, startDate: string, endDate: string, channelId: string): Promise<Kudos[]> {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(
      'SELECT * FROM kudos WHERE workspaceId = ? AND createdAt >= ? AND createdAt <= ? AND channelId = ? ORDER BY createdAt DESC'
    )
    const rows = stmt.all(workspaceId, startDate, endDate, channelId) as unknown as Kudos[]
    return rows
  }

  async getKudosById(id: string): Promise<Kudos | null> {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM kudos WHERE id = ?')
    const row = stmt.get(id) as unknown as Kudos | undefined
    return row ?? null
  }

  async deleteKudos(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('DELETE FROM kudos WHERE id = ?')
    stmt.run(id)
  }

  async updateKudos(id: string, reason: string, emoji: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('UPDATE kudos SET reason = ?, emoji = ? WHERE id = ?')
    stmt.run(reason, emoji, id)
  }

  async getSettings(workspaceId: string): Promise<Settings | null> {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare('SELECT * FROM settings WHERE workspaceId = ?')
    const row = stmt.get(workspaceId) as unknown as Settings | undefined
    return row ?? null
  }

  async saveSettings(settings: Settings): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO settings (workspaceId, digestChannelId, digestDay, digestHour, digestMinute, aiProvider, aiApiKey, aiModel, aiBaseUrl, digestStyle, workflowTriggerId, digestPostAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    stmt.run(
      settings.workspaceId,
      settings.digestChannelId,
      settings.digestDay,
      settings.digestHour,
      settings.digestMinute,
      settings.aiProvider,
      settings.aiApiKey,
      settings.aiModel,
      settings.aiBaseUrl,
      settings.digestStyle,
      settings.workflowTriggerId ?? null,
      settings.digestPostAt ?? null,
      settings.createdAt,
      settings.updatedAt
    )
  }

  async getWeeklyKudos(workspaceId: string, date: Date): Promise<Kudos[]> {
    const startOfWeek = new Date(date)
    const day = startOfWeek.getUTCDay()
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - day + 1)
    startOfWeek.setUTCHours(0, 0, 0, 0)

    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setUTCDate(startOfWeek.getUTCDate() + 6)
    endOfWeek.setUTCHours(23, 59, 59, 999)

    return this.getKudosByDateRange(
      workspaceId,
      startOfWeek.toISOString(),
      endOfWeek.toISOString()
    )
  }

  async close(): Promise<void> {
    this.db?.close()
    this.db = null
  }
}

export const db = new DatabaseService()
export default DatabaseService
