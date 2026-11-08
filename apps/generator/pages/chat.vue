<template>
  <div
    class="h-full flex flex-col relative"
    @dragover.prevent="dragging = true"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- 拖拽上传覆盖层 -->
    <div
      v-if="dragging"
      class="absolute inset-3 z-30 rounded-2xl bg-primary-50/90 border-2 border-dashed border-primary-400 flex items-center justify-center pointer-events-none"
    >
      <div class="text-center">
        <Upload class="w-8 h-8 text-primary-500 mx-auto mb-2" />
        <p class="text-sm text-primary-600 font-medium">松手即可上传到资料库</p>
        <p class="text-[11px] text-primary-500 mt-1">上传后可以直接就文档内容提问</p>
      </div>
    </div>

    <!-- 顶栏 -->
    <header class="h-12 px-5 flex items-center justify-between flex-shrink-0">
      <div class="flex items-center gap-2">
        <h1 class="text-sm font-semibold text-slate-800">对话</h1>
        <span class="text-[11px] text-slate-400">记录与资料都能问</span>
      </div>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          @click="startNewChat"
        >
          <Plus class="w-3.5 h-3.5" />
          新对话
        </button>
      </div>
    </header>

    <!-- 今日/明日提醒 -->
    <div v-if="reminderCount > 0" class="px-4 flex-shrink-0">
      <div class="max-w-3xl mx-auto">
        <button
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700 hover:bg-amber-100 transition-colors"
          @click="reminderOpen = !reminderOpen"
        >
          <Bell class="w-3.5 h-3.5 flex-shrink-0" />
          <span v-if="reminders.today.length > 0">今天 {{ reminders.today.length }} 项</span>
          <span v-if="reminders.today.length > 0 && reminders.tomorrow.length > 0">·</span>
          <span v-if="reminders.tomorrow.length > 0">明天 {{ reminders.tomorrow.length }} 项</span>
          <ChevronDown
            class="w-3.5 h-3.5 ml-auto transition-transform"
            :class="reminderOpen && 'rotate-180'"
          />
        </button>
        <div
          v-if="reminderOpen"
          class="mt-1 px-3 py-2 bg-white border border-amber-200 rounded-xl space-y-1"
        >
          <div
            v-for="item in reminders.today"
            :key="'t' + item.id + item.startAt"
            class="flex items-center gap-2 text-xs text-slate-600"
          >
            <span class="text-amber-600 font-medium flex-shrink-0 w-8">今天</span>
            <span class="text-slate-400 flex-shrink-0">{{ fmtClock(item.startAt) }}</span>
            <span class="truncate">{{ item.title }}</span>
          </div>
          <div
            v-for="item in reminders.tomorrow"
            :key="'m' + item.id + item.startAt"
            class="flex items-center gap-2 text-xs text-slate-600"
          >
            <span class="text-slate-400 font-medium flex-shrink-0 w-8">明天</span>
            <span class="text-slate-400 flex-shrink-0">{{ fmtClock(item.startAt) }}</span>
            <span class="truncate">{{ item.title }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 消息流 -->
    <div ref="scrollEl" class="flex-1 overflow-y-auto light-scroll px-4">
      <!-- 空态 -->
      <div v-if="messages.length === 0" class="h-full flex flex-col items-center justify-center">
        <div class="w-12 h-12 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
          <Sparkles class="w-5 h-5 text-primary-500" />
        </div>
        <p class="text-base font-medium text-slate-700">有什么想记下来，或者想问的？</p>
        <p class="text-xs text-slate-400 mt-1">说一句话我会整理成记录；也可以直接上传文档再提问</p>
        <div class="mt-5 flex flex-wrap justify-center gap-2 max-w-lg">
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

      <div v-else class="max-w-3xl mx-auto py-4 space-y-5">
        <div
          v-for="message in messages"
          :key="message.id"
          :class="message.role === 'user' ? 'flex justify-end' : 'flex justify-start'"
        >
          <!-- 用户消息 -->
          <div
            v-if="message.role === 'user'"
            class="max-w-[72%] bg-primary-500 text-white text-sm rounded-2xl rounded-br-md px-3.5 py-2.5 leading-6"
          >
            <div v-if="message.attachment" class="flex items-center gap-2">
              <FileText class="w-4 h-4 flex-shrink-0 opacity-90" />
              <span class="truncate">{{ message.attachment.name }}</span>
              <span class="text-[11px] opacity-70 flex-shrink-0">{{
                message.attachment.sizeLabel
              }}</span>
            </div>
            <p v-if="message.content" class="whitespace-pre-wrap">{{ message.content }}</p>
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
    <footer class="px-4 pb-4 pt-1 flex-shrink-0">
      <div class="max-w-3xl mx-auto">
        <!-- 上传中的附件 -->
        <div v-if="uploads.length > 0" class="flex flex-wrap gap-2 mb-2">
          <div
            v-for="chip in uploads"
            :key="chip.id"
            class="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-600"
          >
            <FileText class="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span class="truncate max-w-[150px]">{{ chip.name }}</span>
            <Loader2
              v-if="chip.status === 'uploading'"
              class="w-3.5 h-3.5 text-primary-500 animate-spin flex-shrink-0"
            />
            <Check
              v-else-if="chip.status === 'done'"
              class="w-3.5 h-3.5 text-emerald-500 flex-shrink-0"
            />
            <button
              v-else
              type="button"
              class="p-0.5 text-slate-300 hover:text-slate-500"
              @click="removeChip(chip.id)"
            >
              <X class="w-3 h-3" />
            </button>
          </div>
        </div>

        <!-- 「+」面板打开时的点击遮罩 -->
        <div v-if="panelOpen" class="fixed inset-0 z-10" @click="closePanel" />

        <div
          class="flex items-end gap-1.5 rounded-2xl border border-slate-300 bg-white pl-1.5 pr-2 py-1.5 shadow-sm focus-within:border-primary-400 focus-within:ring-1 focus-within:ring-primary-400 transition-shadow"
        >
          <div class="relative flex-shrink-0">
            <button
              type="button"
              class="p-2 rounded-xl transition-colors"
              :class="
                panelOpen
                  ? 'bg-slate-100 text-slate-600'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
              "
              title="添加资料"
              @click.stop="panelOpen = !panelOpen"
            >
              <Plus class="w-4 h-4" />
            </button>

            <!-- 「+」弹出面板 -->
            <Transition
              enter-active-class="transition duration-150 ease-out"
              leave-active-class="transition duration-100 ease-in"
              enter-from-class="opacity-0 translate-y-1"
              leave-to-class="opacity-0 translate-y-1"
            >
              <div
                v-if="panelOpen"
                class="absolute bottom-full left-0 mb-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-lg p-1.5 z-20"
                @click.stop
              >
                <template v-if="!urlMode">
                  <button
                    type="button"
                    class="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-slate-50 transition-colors text-left"
                    @click="pickFiles"
                  >
                    <span
                      class="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0"
                    >
                      <FileUp class="w-4 h-4 text-primary-500" />
                    </span>
                    <span>
                      <span class="block text-sm text-slate-700">上传文件</span>
                      <span class="block text-[11px] text-slate-400"
                        >.txt / .md / .json / .pdf / .doc / .docx</span
                      >
                    </span>
                  </button>
                  <button
                    type="button"
                    class="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-slate-50 transition-colors text-left"
                    @click="urlMode = true"
                  >
                    <span
                      class="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0"
                    >
                      <Link2 class="w-4 h-4 text-emerald-500" />
                    </span>
                    <span>
                      <span class="block text-sm text-slate-700">粘贴链接</span>
                      <span class="block text-[11px] text-slate-400">导入网页内容</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-slate-50 transition-colors text-left"
                    @click="openLibrary"
                  >
                    <span
                      class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0"
                    >
                      <Library class="w-4 h-4 text-slate-500" />
                    </span>
                    <span>
                      <span class="block text-sm text-slate-700">资料库</span>
                      <span class="block text-[11px] text-slate-400">管理已入库的文档</span>
                    </span>
                  </button>
                </template>

                <!-- 链接导入 -->
                <div v-else class="p-1.5">
                  <p class="text-[11px] text-slate-400 mb-1.5">
                    粘贴 http / https 链接，导入网页内容
                  </p>
                  <div class="flex gap-1.5">
                    <input
                      v-model="urlInput"
                      type="url"
                      placeholder="https://…"
                      class="flex-1 text-sm px-2.5 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
                      @keyup.enter="importUrl"
                    />
                    <button
                      type="button"
                      class="px-2.5 py-1.5 bg-primary-500 text-white text-xs rounded-lg hover:bg-primary-600 disabled:opacity-40 transition-colors"
                      :disabled="!urlInput.trim() || urlLoading"
                      @click="importUrl"
                    >
                      <Loader2 v-if="urlLoading" class="w-3.5 h-3.5 animate-spin" />
                      <template v-else>导入</template>
                    </button>
                  </div>
                  <button
                    type="button"
                    class="mt-1.5 text-[11px] text-slate-400 hover:text-slate-600"
                    @click="urlMode = false"
                  >
                    返回
                  </button>
                </div>
              </div>
            </Transition>
          </div>
          <textarea
            ref="textareaEl"
            v-model="input"
            rows="1"
            placeholder="说点什么，Enter 发送，Shift + Enter 换行"
            class="flex-1 text-sm text-slate-800 resize-none focus:outline-none leading-6 max-h-36 bg-transparent py-1.5"
            @input="autoGrow"
            @keydown.enter.exact.prevent="send"
          />
          <button
            type="button"
            class="p-2 rounded-xl transition-colors flex-shrink-0"
            :class="
              input.trim() && !sending
                ? 'bg-primary-500 text-white hover:bg-primary-600'
                : 'bg-slate-100 text-slate-300'
            "
            :disabled="!input.trim() || sending"
            @click="send"
          >
            <ArrowUp class="w-4 h-4" />
          </button>
        </div>

        <input
          ref="fileInputEl"
          type="file"
          multiple
          accept=".txt,.md,.json,.pdf,.doc,.docx"
          class="hidden"
          @change="onFileSelect"
        />
        <p class="mt-1.5 text-center text-[10px] text-slate-400">
          支持 .txt / .md / .json / .pdf / .doc / .docx，也可直接拖拽文件进来
        </p>
      </div>
    </footer>

    <CitationDrawer :citation="activeCitation" @close="activeCitation = null" />
  </div>
</template>

<script setup lang="ts">
import {
  ArrowUp,
  Bell,
  Check,
  ChevronDown,
  FileText,
  FileUp,
  Library,
  Link2,
  Loader2,
  Plus,
  Sparkles,
  Upload,
  X,
} from 'lucide-vue-next'
import {
  apiGet,
  apiPost,
  apiUpload,
  type ChatAnswer,
  type Citation,
  type CreateEntryPayload,
  type DocumentRow,
  type EntryCard as EntryCardData,
  type ExtractResponse,
  type RemindersResponse,
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

interface UploadChip {
  id: string
  name: string
  status: 'uploading' | 'done' | 'error'
}

interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachment?: { name: string; sizeLabel: string }
  cards?: UiCard[]
  citations?: Citation[]
  missing?: string[]
  degraded?: boolean
  general?: boolean
  loading?: boolean
  error?: string
}

const ACCEPT_EXTS = ['.txt', '.md', '.json', '.pdf', '.doc', '.docx']

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
const fileInputEl = ref<HTMLInputElement | null>(null)
const uploads = ref<UploadChip[]>([])
const dragging = ref(false)
const libraryOpen = useState<boolean>('libraryOpen', () => false)
const panelOpen = ref(false)
const urlMode = ref(false)
const urlInput = ref('')
const urlLoading = ref(false)
const reminders = ref<RemindersResponse>({ today: [], tomorrow: [] })
const reminderOpen = ref(false)
const reminderCount = computed(() => reminders.value.today.length + reminders.value.tomorrow.length)

/** 今日/明日提醒：进对话页拉一次，确认卡片入库后再刷新（spec 阶段 10） */
const fetchReminders = async () => {
  try {
    reminders.value = await apiGet<RemindersResponse>('/api/reminders')
  } catch {
    /* 后端未启动时静默 */
  }
}

const fmtClock = (ms: number): string => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const uid = () => Math.random().toString(36).slice(2, 10)

const openLibrary = () => {
  closePanel()
  libraryOpen.value = true
}

const closePanel = () => {
  panelOpen.value = false
  urlMode.value = false
  urlInput.value = ''
}

const pickFiles = () => {
  closePanel()
  fileInputEl.value?.click()
}

/** 面板里的「粘贴链接」：同步导入网页，反馈解析结果 */
const importUrl = async () => {
  const url = urlInput.value.trim()
  if (!url || urlLoading.value) return
  urlLoading.value = true
  try {
    const doc = await apiPost<{ id: string; name: string; chunkCount: number }>(
      '/api/rag/documents/url',
      { url },
    )
    const sid = await ensureSession(doc.name || url)
    await persistMessage(sid, 'user', `导入链接：${url}`)
    const ack = `《${doc.name}》解析成功。`
    messages.value.push({ id: uid(), role: 'assistant', content: ack })
    await persistMessage(sid, 'assistant', ack)
    closePanel()
  } catch (error) {
    messages.value.push({
      id: uid(),
      role: 'assistant',
      content: '',
      error: (error as Error).message,
    })
  } finally {
    urlLoading.value = false
    await scrollToBottom()
  }
}

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
  const session = await apiPost<SessionSummary>('/api/sessions', { title: title.slice(0, 20) })
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
  uploads.value = []
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
        const upload = /^上传文档[：:]\s*(.+)$/.exec(message.content)
        return {
          id: message.id,
          role: message.role as 'user' | 'assistant',
          content: upload ? '' : message.content,
          attachment: upload ? { name: upload[1], sizeLabel: '' } : undefined,
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

onMounted(() => {
  void loadLatestSession()
  void fetchReminders()
})

// ── 文档上传 ────────────────────────────────────────

const formatSize = (bytes: number): string => {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const isSupported = (name: string): boolean => {
  const dot = name.lastIndexOf('.')
  return dot >= 0 && ACCEPT_EXTS.includes(name.slice(dot).toLowerCase())
}

const removeChip = (id: string) => {
  uploads.value = uploads.value.filter((chip) => chip.id !== id)
}

/** 上传后文档在后台解析，轮询列表直到终态再反馈结果 */
const waitForDocument = async (id: string): Promise<DocumentRow | null> => {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 700))
    try {
      const list = await apiGet<DocumentRow[]>('/api/documents')
      const doc = list.find((item) => item.id === id)
      if (!doc) return null
      if (doc.status !== 'processing') return doc
    } catch {
      /* 后台写库时偶发失败，继续轮询 */
    }
  }
  return null
}

const uploadFiles = async (files: File[]) => {
  if (files.length === 0) return

  for (const file of files) {
    if (!isSupported(file.name)) {
      messages.value.push({
        id: uid(),
        role: 'assistant',
        content: '',
        error: `不支持的文件格式：${file.name}`,
      })
      continue
    }

    const sid = await ensureSession(file.name)
    const chip: UploadChip = { id: uid(), name: file.name, status: 'uploading' }
    uploads.value.push(chip)
    messages.value.push({
      id: uid(),
      role: 'user',
      content: '',
      attachment: { name: file.name, sizeLabel: formatSize(file.size) },
    })
    await scrollToBottom()

    try {
      const form = new FormData()
      form.append('file', file)
      const created = await apiUpload<{ id: string; name: string; status: string }>(
        '/api/documents/upload',
        form,
      )
      const doc = await waitForDocument(created.id)

      chip.status = doc?.status === 'failed' ? 'error' : 'done'
      await persistMessage(sid, 'user', `上传文档：${file.name}`)

      let ack: string
      if (!doc || doc.status === 'processing') {
        ack = `《${file.name}》还在解析中，稍等片刻就能就它提问。`
      } else if (doc.status === 'ready') {
        ack = `《${file.name}》解析成功。`
      } else {
        ack = `《${file.name}》解析失败，可能是空文档、扫描件或格式不支持。`
      }
      messages.value.push({ id: uid(), role: 'assistant', content: ack })
      await persistMessage(sid, 'assistant', ack)
      setTimeout(() => removeChip(chip.id), 1800)
    } catch (error) {
      chip.status = 'error'
      messages.value.push({
        id: uid(),
        role: 'assistant',
        content: '',
        error: (error as Error).message,
      })
    }
    await scrollToBottom()
  }
}

const onFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = target.files ? Array.from(target.files) : []
  target.value = ''
  void uploadFiles(files)
}

let dragDepth = 0
const onDragLeave = () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragging.value = false
}

const onDrop = (event: DragEvent) => {
  dragDepth = 0
  dragging.value = false
  const files = event.dataTransfer?.files
  if (files && files.length > 0) void uploadFiles(Array.from(files))
}

// ── 发送 ────────────────────────────────────────────

/**
 * 信息存储意图关键词：命中才走「整理入库」，其余一律按问答处理（直接用知识回答）。
 * 默认问答是安全选择——把问题误判成存储会生成空卡片，反过来只是少一次主动整理。
 */
const looksLikeStorage = (text: string): boolean =>
  /记住|帮我记|记一下|记下来|记录一下|存一下|提醒我|别忘了|备忘|收藏一下|加个日程|帮我安排/.test(
    text,
  )

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
  nextTick(autoGrow)

  try {
    const sid = await ensureSession(text)
    messages.value.push({ id: uid(), role: 'user', content: text })
    await scrollToBottom()

    if (!looksLikeStorage(text)) {
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

const confirmCard = async (message: UiMessage, item: UiCard, payload: CreateEntryPayload) => {
  item.saving = true
  try {
    await apiPost('/api/entries', payload)
    item.card = { ...item.card, ...payload } as EntryCardData
    item.state = 'confirmed'
    void fetchReminders()
  } catch (error) {
    messages.value.push({
      id: uid(),
      role: 'assistant',
      content: '',
      error: (error as Error).message,
    })
  } finally {
    item.saving = false
  }
  void message
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
