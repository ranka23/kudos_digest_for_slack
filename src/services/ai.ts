import OpenAI from 'openai'

type AIConfig = {
  aiProvider?: 'openai' | 'anthropic' | 'custom' | 'none' | null
  aiApiKey?: string | null
  aiModel?: string | null
  aiBaseUrl?: string | null
  digestStyle?: 'simple' | 'creative' | null
}

class AIService {
  private openai: OpenAI | null = null
  private settings: AIConfig | null = null
  private config: Record<string, unknown> = {}

  configure(settings: AIConfig): void {
    this.settings = settings

    const baseConfig: Record<string, unknown> = {}

    if (settings.aiProvider === 'none' || !settings.aiApiKey) {
      this.openai = null
      this.config = baseConfig
      return
    }

    baseConfig.apiKey = settings.aiApiKey

    if (settings.aiProvider === 'custom' && settings.aiBaseUrl) {
      baseConfig.baseURL = settings.aiBaseUrl
    }

    this.openai = new OpenAI(baseConfig)
    this.config = baseConfig
  }

  getOpenAIConfig(): Record<string, unknown> {
    return this.config
  }

  async generateDigest(kudosList: { fromUser: string; toUser: string; reason: string; emoji: string }[]): Promise<string> {
    if (!this.openai || !this.settings) {
      return this.generateSimpleDigest(kudosList)
    }

    try {
      const model = this.settings.aiModel ?? this.getDefaultModel()

      if (this.settings.digestStyle === 'creative') {
        return this.generateCreativeDigest(kudosList, model)
      }

      return this.generateFormattedDigest(kudosList, model)
    } catch (error) {
      console.error('AI digest generation failed, falling back to simple:', error)
      return this.generateSimpleDigest(kudosList)
    }
  }

  private getDefaultModel(): string {
    if (this.settings?.aiProvider === 'anthropic') {
      return 'claude-3-opus-20240229'
    }
    return 'gpt-4o-mini'
  }

  private async generateCreativeDigest(kudosList: { fromUser: string; toUser: string; reason: string; emoji: string }[], model: string): Promise<string> {
    if (!this.openai) throw new Error('OpenAI not configured')

    const prompt = `You are a friendly workplace culture assistant. Analyze these kudos and create an engaging weekly digest.

Format your response in Slack markdown with:
- A warm, encouraging header
- Group kudos by recipient with their total count
- Extract 3-5 themes/trends from the kudos
- Highlight 2-3 most meaningful kudos
- End with a positive team morale message

Kudos data:
${kudosList.map((k, i) => `${i + 1}. "${k.reason}" (${k.emoji}) from ${k.fromUser} to ${k.toUser}`).join('\n')}

Be creative, warm, and professional. Use emojis sparingly in the header only.`

    const completion = await this.openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
    })

    const content = completion.choices[0]?.message?.content
    return content ?? this.generateSimpleDigest(kudosList)
  }

  private async generateFormattedDigest(kudosList: { fromUser: string; toUser: string; reason: string; emoji: string }[], model: string): Promise<string> {
    if (!this.openai) throw new Error('OpenAI not configured')

    const prompt = `Format these kudos into a clean, professional Slack markdown digest. Use headers, bullet points, and code blocks appropriately.

Kudos:
${kudosList.map((k) => `- ${k.emoji} ${k.toUser} received kudos from ${k.fromUser}: "${k.reason}"`).join('\n')}

Keep it structured but don't add creative commentary.`

    const completion = await this.openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
    })

    const content = completion.choices[0]?.message?.content
    return content ?? this.generateSimpleDigest(kudosList)
  }

  private generateSimpleDigest(kudosList: { fromUser: string; toUser: string; reason: string; emoji: string }[]): string {
    const userKudos: Record<string, { count: number; reasons: string[] }> = {}

    for (const kudo of kudosList) {
      if (!userKudos[kudo.toUser]) {
        userKudos[kudo.toUser] = { count: 0, reasons: [] }
      }
      userKudos[kudo.toUser].count++
      userKudos[kudo.toUser].reasons.push(kudo.reason)
    }

    let digest = '*Weekly Kudos Digest* :tada:\n\n'

    const sortedUsers = Object.entries(userKudos).sort((a, b) => b[1].count - a[1].count)

    for (const [user, data] of sortedUsers) {
      digest += `*${user}* received ${data.count} kudo${data.count > 1 ? 's' : ''}:\n`
      for (const reason of data.reasons) {
        digest += `  - "${reason}"\n`
      }
      digest += '\n'
    }

    digest += `\nTotal recognition this week: ${kudosList.length} kudos given! :star:`
    return digest
  }
}

export const aiService = new AIService()
export default AIService
