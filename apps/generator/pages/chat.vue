<template>
  <div class="h-full flex flex-col">
    <!-- 页头 -->
    <header
      class="h-14 px-6 flex items-center justify-between border-b border-slate-200 flex-shrink-0"
    >
      <div class="flex items-center gap-2">
        <h2 class="text-base font-semibold text-slate-800">对话</h2>
        <span class="text-[11px] text-slate-400">录入与问答共用</span>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-[11px] text-slate-400">{{ model }}</span>
        <button
          type="button"
          class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
          @click="startNewChat"
        >
          <Plus class="w-3.5 h-3.5" />
          新对话
        </button>
      </div>
    </header>

    <!-- 消息流 -->
    <div ref="scrollEl" class="flex-1 overflow-y-auto light-scroll px-6 py-5">
      <!-- 空态 -->
      <div v-if="messages.length === 0" class="h-full flex flex-col items-center justify-center">
        <div class="w-11 h-11 rounded-xl bg-primary-50 flex items-center justify-center mb-3">
          <MessageSquare class="w-5 h-5 text-primary-500" />
        </div>
        <p class="text-sm text-slate-600">说点什么，我会记住，也会在回答时引用你的记录</p>
        <div class="mt-4 flex flex-wrap justify-center gap-2 max-w-lg">
          <button
            v-for="example in examples"
            :key="example"
            type="button"
            class="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-full hover:border-primary-300 hover:text-primary-600 transition-colors"
            @click="fillExample(example)"
          >
            {{ example }}
          </button>
        </div>
      </div>

      <div v-else class="max-w-3xl mx-auto space-y-5">
        <div
          v-for="message in messages"
          :key="message.id"
          :class="message.role === 'user' ? 'flex justify-end' : 'flex justify-start'"
        >
          <!-- 用户消息 -->
          <div
            v-if="message.role === 'user'"
            class="max-w-[72%] bg-primary-500 text-white text-sm rounded-2xl rounded-br-md px-3.5 py-2.5 whitespace-pre-wrap leading-6"
          >
            {{ message.content }}
          </div>

          <!-- 助手消息 -->
          <div v-else class="max-w-[78%] w-full">
            <!-- 加载中 -->
            <div
              v-if="message.loading"
              class="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3"
            >
              <span class="dot" />
              <span class="dot" style="animation-delay: 0.15s" />
              <span class="dot" style="animation-delay: 0.3s" />
            </div>

            <!-- 错误 -->
            <div
              v-else-if="message.error"
              class="text-xs text-red-500 bg-red-50 border border-red-100 rounded-xl px-3 py-2"
            >
              出错了：{{ message.error }}
            </div>

            <!-- 抽取卡片 -->
            <div v-else-if="message.cards && message.cards.length > 0">
              <div class="flex items-center justify-between mb-2">
                <p class="text-xs text-slate-500">
                  整理出 {{ message.cards.length }} 条记录，确认后入库
                </p>
                <button
                  v-if="pendingCount(message) > 1"
                  type="button"
                  class="text-[11px] text-primary-600 hover:underline"
                  @click="confirmAll(message)"
                >
                  全部确认
                </button>
              </div>
              <div class="space-y-2">
                <EntryCard
                  v-for="item in message.cards"
                  :key="item.key"
                  :card="item.card"
                  :state="item.state"
                  :saving="item.saving"
                  @confirm="(payload) => confirmCard(message, item, payload)"
                  @ignore="item.state = 'ignored'"
                  @edit="item.state = 'editing'"
                  @cancel="item.state = 'pending'"
                />
                <p v-if="itemError(message)" class="text-[11px] text-red-500">
                  {{ itemError(message) }}
                </p>
              </div>
            </div>

            <!-- 普通回答 -->
            <template v-else>
              <div
                class="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3"
                @click="onAnswerClick"
              >
                <div
                  class="answer-body text-sm text-slate-800 leading-6"
                  v-html="renderAnswer(message.content)"
                />
                <p
                  v-if="message.degraded && !message.general"
                  class="mt-2 text-[11px] text-amber-600"
                >
                  回答生成超时或失败，以上是检索到的相关记录。
                </p>
                <CitationList
                  v-if="message.citations && message.citations.length > 0"
                  :citations="message.citations"
                  :missing="message.missing ?? []"
                  @open="openCitation"
                />
                <p
                  v-else-if="message.missing && message.missing.length > 0"
                  class="mt-2 text-[11px] text-slate-400"
                >
                  未命中：{{ message.missing.join('、') }}
                </p>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <footer class="border-t border-slate-200 px-6 py-3 flex-shrink-0">
      <div class="max-w-3xl mx-auto">
        <div
          class="flex items-end gap-2 border border-slate-300 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-primary-400 focus-within:border-transparent transition-shadow"
        >
          <textarea
            ref="textareaEl"
            v-model="input"
            rows="1"
            placeholder="说点什么，Enter 发送，Shift + Enter 换行"
            class="flex-1 text-sm text-slate-800 resize-none focus:outline-none leading-6 max-h-36 bg-transparent"
            :disabled="sending"
            @input="autoGrow"
            @keydown.enter.exact.prevent="send"
          />
          <button
            type="button"
            class="p-1.5 rounded-lg transition-colors flex-shrink-0"
            :class="
              input.trim() && !sending
                ? 'bg-primary-500 text-white hover:bg-primary-600'
                : 'text-slate-300'
            "
            :disabled="!input.trim() || sending"
            @click="send"
          >
            <Send class="w-4 h-4" />
          </button>
        </div>
        <p class="mt-1.5 text-[10px] text-slate-400">
          陈述句会被整理成记录，问句会基于你的记录作答
        </p>
      </div>
    </footer>

    <CitationDrawer :citation="activeCitation" @close="activeCitation = null" />
  </div>
</template>

<script setup lang="ts">
import { Plus, MessageSquare, Send } from 'lucide-vue-next'
import {
  apiGet,
  apiPost,
  type ChatAnswer,
  type Citation,
  type CreateEntryPayload,
  type EntryCard as EntryCardData,
  type ExtractResponse,
  type SessionDetail,
  type SessionMessage,
  type SessionSummary,
} from '~/utils/api'
import { citationFromEvent, renderAnswer } from '~/utils/markdown'

type CardState = 'pending' | 'confirmed' | 'ignored' | 'editing'

interface UiCard {
  key: string
  card: EntryCardData
  state: CardState
  saving: boolean
}

interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  cards?: UiCard[]
  citations?: Citation[]
  missing?: string[]
  degraded?: boolean
  general?: boolean
  loading?: boolean
  error?: string
}

const model = 'glm-4-flash'
const examples = [
  '下周有什么安排',
  '我习惯用什么技术风格',
  '每周一上午九点开周会',
  '帮我规划学完前端工程化',
]

const messages = ref<UiMessage[]>([])
const input = ref('')
const sending = ref(false)
const sessionId = ref<string | null>(null)
const activeCitation = ref<Citation | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const textareaEl = ref<HTMLTextAreaElement | null>(null)
const cardError = ref('')

const uid = () => Math.random().toString(36).slice(2, 10)

const scrollToBottom = async () => {
  await nextTick()
  const el = scrollEl.value
  if (el) el.scrollTop = el.scrollHeight
}

const autoGrow = () => {
  const el = textareaEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 144)}px`
}

const fillExample = (text: string) => {
  input.value = text
  nextTick(autoGrow)
}

const onAnswerClick = (event: Event) => {
  const num = citationFromEvent(event)
  if (num === null) return
  const message = messages.value.find((m) => m.citations?.some((citation) => citation.num === num))
  const citation = message?.citations?.find((item) => item.num === num)
  if (citation) activeCitation.value = citation
}

const openCitation = (citation: Citation) => {
  activeCitation.value = citation
}

// ── 会话 ────────────────────────────────────────────

const ensureSession = async (title: string): Promise<string> => {
  if (sessionId.value) return sessionId.value
  const session = await apiPost<SessionSummary>('/api/sessions', {
    title: title.slice(0, 20),
  })
  sessionId.value = session.id
  return session.id
}

const persistMessage = async (sid: string, role: 'user' | 'assistant', content: string) => {
  await apiPost<SessionMessage>(`/api/sessions/${sid}/messages`, { role, content })
}

const startNewChat = () => {
  sessionId.value = null
  messages.value = []
  input.value = ''
  cardError.value = ''
  nextTick(autoGrow)
}

const parseMeta = (metadata: SessionMessage['metadata']): Record<string, unknown> => {
  if (!metadata) return {}
  if (typeof metadata === 'object') return metadata
  try {
    return JSON.parse(metadata) as Record<string, unknown>
  } catch {
    return {}
  }
}

const loadLatestSession = async () => {
  try {
    const sessions = await apiGet<SessionSummary[]>('/api/sessions')
    if (sessions.length === 0) return
    const detail = await apiGet<SessionDetail>(`/api/sessions/${sessions[0].id}`)
    sessionId.value = detail.id
    messages.value = detail.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => {
        const meta = parseMeta(message.metadata)
        return {
          id: message.id,
          role: message.role as 'user' | 'assistant',
          content: message.content,
          citations: message.citations ?? undefined,
          missing: Array.isArray(meta.missing) ? (meta.missing as string[]) : [],
          degraded: meta.degraded === true,
        }
      })
    await scrollToBottom()
  } catch {
    /* 后端未启动时保持空态 */
  }
}

onMounted(loadLatestSession)

// ── 发送 ────────────────────────────────────────────

/** 明显是疑问句时直接走问答，省一次抽取调用（疑问词出现在句中也要识别） */
const looksLikeQuestion = (text: string): boolean =>
  /[?？]|(吗|呢)[。！!]?$/.test(text) ||
  /什么|怎么|为什么|哪些|哪个|多少|如何|是否|有没有|能不能|几时|什么时候/.test(text)

const askAI = async (text: string, sid: string) => {
  const placeholder: UiMessage = { id: uid(), role: 'assistant', content: '', loading: true }
  messages.value.push(placeholder)
  await scrollToBottom()

  try {
    const answer = await apiPost<ChatAnswer>('/api/chat', { message: text, sessionId: sid })
    placeholder.loading = false
    placeholder.content = answer.reply
    placeholder.citations = answer.citations
    placeholder.missing = answer.missing
    placeholder.degraded = answer.degraded
    placeholder.general = answer.general
  } catch (error) {
    placeholder.loading = false
    placeholder.error = (error as Error).message
  }
  await scrollToBottom()
}

const send = async () => {
  const text = input.value.trim()
  if (!text || sending.value) return

  sending.value = true
  input.value = ''
  cardError.value = ''
  nextTick(autoGrow)

  try {
    const sid = await ensureSession(text)
    messages.value.push({ id: uid(), role: 'user', content: text })
    await scrollToBottom()

    if (looksLikeQuestion(text)) {
      await askAI(text, sid)
      return
    }

    const extracted = await apiPost<ExtractResponse>('/api/extract', { text, sessionId: sid })

    if (extracted.intent === 'record' && extracted.entries.length > 0) {
      await persistMessage(sid, 'user', text)
      const summary = `整理出 ${extracted.entries.length} 条记录，请确认入库`
      await persistMessage(sid, 'assistant', summary)
      messages.value.push({
        id: uid(),
        role: 'assistant',
        content: summary,
        cards: extracted.entries.map((card, index) => ({
          key: `${index}-${card.title}`,
          card,
          state: 'pending',
          saving: false,
        })),
      })
    } else {
      await askAI(text, sid)
    }
  } catch (error) {
    messages.value.push({
      id: uid(),
      role: 'assistant',
      content: '',
      error: (error as Error).message,
    })
  } finally {
    sending.value = false
    await scrollToBottom()
  }
}

// ── 抽取卡片 ────────────────────────────────────────

const pendingCount = (message: UiMessage): number =>
  (message.cards ?? []).filter((item) => item.state === 'pending').length

const itemError = (message: UiMessage): string =>
  message.id === cardError.value.split('::')[0] ? (cardError.value.split('::')[1] ?? '') : ''

const confirmCard = async (message: UiMessage, item: UiCard, payload: CreateEntryPayload) => {
  item.saving = true
  cardError.value = ''
  try {
    await apiPost('/api/entries', payload)
    item.card = { ...item.card, ...payload } as EntryCardData
    item.state = 'confirmed'
  } catch (error) {
    cardError.value = `${message.id}::${(error as Error).message}`
  } finally {
    item.saving = false
  }
}

const confirmAll = async (message: UiMessage) => {
  const pending = (message.cards ?? []).filter((item) => item.state === 'pending')
  for (const item of pending) {
    const payload: CreateEntryPayload = {
      type: item.card.type,
      title: item.card.title,
      content: item.card.content,
      status: 'active',
      startAt: item.card.time?.start ?? null,
      endAt: item.card.time?.end ?? null,
      recurrence: item.card.recurrence,
      sourceType: 'conversation',
      confidence: item.card.confidence,
    }
    await confirmCard(message, item, payload)
  }
}
</script>

<style scoped>
.dot {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background-color: #94a3b8;
  animation: bounce 1.1s infinite ease-in-out;
  display: inline-block;
}

@keyframes bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }
  40% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

:deep(.answer-body p) {
  margin: 0 0 0.5rem;
}

:deep(.answer-body p:last-child) {
  margin-bottom: 0;
}

:deep(.answer-body ul),
:deep(.answer-body ol) {
  margin: 0.25rem 0 0.5rem;
  padding-left: 1.25rem;
  list-style: disc;
}

:deep(.answer-body ol) {
  list-style: decimal;
}

:deep(.answer-body code) {
  background-color: #f1f5f9;
  padding: 0.1rem 0.3rem;
  border-radius: 0.25rem;
  font-size: 0.8em;
}

:deep(.answer-body pre) {
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 0.5rem;
  padding: 0.6rem 0.75rem;
  overflow-x: auto;
  margin: 0.5rem 0;
}

:deep(.answer-body pre code) {
  background: transparent;
  padding: 0;
}

:deep(.cite-chip) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.2rem;
  margin: 0 0.1rem;
  border-radius: 0.25rem;
  background-color: #eff6ff;
  color: #2563eb;
  font-size: 0.65rem;
  font-weight: 600;
  vertical-align: middle;
  cursor: pointer;
}

:deep(.cite-chip:hover) {
  background-color: #dbeafe;
}
</style>
