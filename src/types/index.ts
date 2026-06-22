export interface Kudos {
  id: string
  fromUserId: string
  fromUserName: string
  toUserId: string
  toUserName: string
  reason: string
  emoji: string
  channelId: string
  channelName: string | null
  createdAt: string
  workspaceId: string
}

export interface Settings {
  workspaceId: string
  digestChannelId: string | null
  digestDay: number
  digestHour: number
  digestMinute: number
  aiProvider: 'openai' | 'anthropic' | 'custom' | 'none'
  aiApiKey: string | null
  aiModel: string | null
  aiBaseUrl: string | null
  digestStyle: 'simple' | 'creative'
  workflowTriggerId: string | null
  digestPostAt: string | null
  createdAt: string
  updatedAt: string
}

export interface KudosExport {
  fromUser: string
  toUser: string
  reason: string
  emoji: string
  channel: string
  date: string
}

export interface Reaction {
  id: string
  kudosId: string
  userId: string
  reaction: string
  createdAt: string
}