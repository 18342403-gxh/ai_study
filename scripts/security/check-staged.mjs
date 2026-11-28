#!/usr/bin/env node
/**
 * 提交前安全检查
 * 用法：
 *   node scripts/security/check-staged.mjs        只检查已暂存文件（pre-commit 自动调用）
 *   node scripts/security/check-staged.mjs --all  检查全部已跟踪文件
 *
 * 检查两类问题：
 *   1. 路径：项目外目录（.trae/.kiro 等）、.env、私钥/证书文件
 *   2. 内容：API Key、私钥、服务器地址/部署信息、硬编码口令
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const scanAll = process.argv.includes('--all')
const SELF = 'scripts/security/check-staged.mjs'
const SKIP_FILES = new Set([SELF, 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const listFiles = () => {
  if (scanAll) {
    return git(['ls-files']).split('\n').filter(Boolean)
  }
  return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .split('\0')
    .filter(Boolean)
}

const readContent = (file) => {
  if (scanAll) return readFileSync(file, 'utf8')
  return git(['show', `:${file}`])
}

/** 禁止提交的路径 */
const PATH_RULES = [
  { re: /^\.trae\//i, why: 'AI 工具目录属于项目外内容，不提交' },
  { re: /^\.trae-configs\//i, why: 'AI 工具配置属于项目外内容，不提交' },
  { re: /^\.kiro\//i, why: 'AI 工具目录属于项目外内容，不提交' },
  { re: /(^|\/)\.screenshots\//i, why: '截图等临时产物不提交' },
  {
    re: /(^|\/)\.env($|\.)(?!(example|template)$)/i,
    why: '环境变量文件禁止提交（仅允许 .env.example / .env.template）',
  },
  { re: /\.(pem|key|p12|pfx|bundle|keystore|jks)$/i, why: '私钥/证书文件禁止提交' },
  { re: /(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/i, why: 'SSH 私钥禁止提交' },
  { re: /(^|\/)\.ssh\//i, why: 'SSH 配置目录禁止提交' },
]

/** 禁止出现的内容 */
const CONTENT_RULES = [
  { id: 'zhipu-key', re: /\b[0-9a-f]{32}\.[A-Za-z0-9]{16}\b/g, why: '疑似智谱 API Key' },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}/g, why: '疑似 OpenAI/sk 格式密钥' },
  {
    id: 'github-token',
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
    why: '疑似 GitHub Token',
  },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g, why: '疑似 AWS AccessKey' },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, why: '疑似 Slack Token' },
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, why: '私钥内容' },
  { id: 'ssh-pubkey', re: /\bssh-(?:rsa|ed25519) AAAA[A-Za-z0-9+/=]{20,}/g, why: 'SSH 公钥' },
  {
    id: 'server-info',
    re: /124\.221\.233\.250|\bubuntu@|\/home\/ubuntu|\/opt\/ai-study|deploy-ai-study/g,
    why: '生产服务器地址/部署信息',
  },
  { id: 'weak-admin', re: /admin129/g, why: '历史默认弱口令' },
  {
    id: 'local-path',
    re: /C:\\Users\\[A-Za-z0-9._-]+/g,
    why: '本机绝对路径（含用户名）',
  },
]

/** 键值型口令：password/token/apiKey = 'xxx'（只检查字符串字面量，避免误伤变量引用） */
const CREDENTIAL_RE =
  /(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*(['"])([^'"]{6,})\1/gi

/** 示例值/占位符放行 */
const isPlaceholder = (value) => {
  const v = value.trim()
  return (
    /^(?:\$\{|\$\(|\$|<|\{|your|change|example|placeholder|xxx|todo|none|null|true|false|123456$)/i.test(
      v,
    ) ||
    /^(?:string|number|boolean|unknown|undefined)$/i.test(v) ||
    /^(?:x{3,}|\*+|\.{3})/i.test(v) ||
    /^sk-x+$/i.test(v) ||
    // 命名空间/事件名，如 server:get-api-key
    /^[a-z][a-z0-9-]*:[a-z][a-z0-9:-]*$/i.test(v) ||
    /(你的|请|示例|替换|填入|占位)/.test(v)
  )
}

const mask = (value) => {
  const v = value.trim()
  return v.length <= 8 ? '***' : `${v.slice(0, 4)}***${v.slice(-2)}`
}

const findings = []
const addFinding = (file, line, id, why, sample) =>
  findings.push({ file, line, id, why, sample })

const files = listFiles().filter((f) => !SKIP_FILES.has(f))

for (const file of files) {
  const pathHit = PATH_RULES.find((rule) => rule.re.test(file))
  if (pathHit) {
    addFinding(file, null, 'path', pathHit.why, null)
    continue
  }

  let content
  try {
    content = readContent(file)
  } catch {
    continue
  }
  if (content.includes('\u0000')) continue // 二进制文件跳过

  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.includes('security:allow')) continue
    const trimmed = line.trimStart()
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue

    for (const rule of CONTENT_RULES) {
      rule.re.lastIndex = 0
      const match = rule.re.exec(line)
      if (match) addFinding(file, i + 1, rule.id, rule.why, mask(match[0]))
    }

    CREDENTIAL_RE.lastIndex = 0
    let credential
    while ((credential = CREDENTIAL_RE.exec(line)) !== null) {
      if (!isPlaceholder(credential[2])) {
        addFinding(file, i + 1, 'credential', '疑似硬编码口令/密钥', mask(credential[2]))
      }
    }
  }
}

if (findings.length === 0) {
  console.log(`✅ 安全检查通过（扫描 ${files.length} 个文件）`)
  process.exit(0)
}

console.error(`❌ 安全检查未通过，共 ${findings.length} 处：\n`)
for (const f of findings) {
  const where = f.line ? `${f.file}:${f.line}` : f.file
  const sample = f.sample ? `  → ${f.sample}` : ''
  console.error(`  ${where}\n    [${f.id}] ${f.why}${sample}`)
}
console.error(
  '\n处理方式：git restore --staged <文件> 移出暂存；密钥改环境变量/占位符；' +
    '确认真实密钥已泄露时立即轮换，并参考 .trae/skills/security-guard/SKILL.md。',
)
process.exit(1)
