/**
 * ESLint Custom Rules
 *
 * 1. no-emoji — 禁止 emoji 作为 UI 图标
 * 2. no-cross-app-import — 禁止 app 之间直接 import（只允许 @ai-study/shared）
 */

// emoji 范围
const EMOJI_REGEX = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu

// 从文件路径提取 app 名（apps/server/... → server）
function getAppName(filePath) {
  const match = filePath.match(/apps[\\/]([^\\/]+)[\\/]/)
  return match ? match[1] : null
}

// 允许跨 app 的包白名单（通过 pnpm workspace 或 node_modules）
const ALLOWED_CROSS_APP = new Set(['@ai-study/shared'])

module.exports = {
  rules: {
    // ── Rule 1: no-cross-app-import ──
    'no-cross-app-import': {
      meta: {
        type: 'problem',
        docs: {
          description: '禁止 app 之间直接 import（只允许 @ai-study/shared 跨 app）',
          recommended: true,
        },
        fixable: null,
        schema: [],
        messages: {
          crossAppImport:
            '[{{myApp}}] 禁止直接 import 另一个 app 的代码 ' +
            '"{{specifier}}"（目标 app: {{targetApp}}）。' +
            '请通过 @ai-study/shared 共享类型/工具，或抽成 package。',
        },
      },

      create(context) {
        const filename = context.filename || context.getFilename?.() || ''

        // 只检查 apps/ 下的源码
        const myApp = getAppName(filename)
        if (!myApp) return {}

        function checkImport(node, specifier) {
          if (!specifier || typeof specifier !== 'string') return

          if (ALLOWED_CROSS_APP.has(specifier)) return

          const crossAppMatch =
            specifier.includes('/apps/') ||
            (specifier.startsWith('@ai-study/') && !ALLOWED_CROSS_APP.has(specifier))

          if (!crossAppMatch) return

          let targetApp = '(unknown)'
          const appsMatch = specifier.match(/apps[\\/]([^\\/]+)/)
          if (appsMatch) targetApp = appsMatch[1]
          else {
            const pkgMatch = specifier.match(/@ai-study\/([^\\/]+)/)
            if (pkgMatch) targetApp = pkgMatch[1]
          }

          context.report({
            node,
            messageId: 'crossAppImport',
            data: { myApp, targetApp, specifier },
          })
        }

        return {
          ImportDeclaration(node) {
            checkImport(node, node.source.value)
          },
          CallExpression(node) {
            const callee = node.callee
            if (callee && callee.name === 'require' && node.arguments[0]) {
              checkImport(node, node.arguments[0].value)
            }
          },
          ImportExpression(node) {
            if (node.source) checkImport(node, node.source.value)
          },
        }
      },
    },

    // ── Rule 2: no-emoji ──
    'no-emoji': {
      meta: {
        type: 'problem',
        docs: {
          description: '禁止 emoji 作为 UI 图标',
          recommended: true,
        },
        fixable: null,
        schema: [],
        messages: {
          forbidden:
            '禁止使用 emoji 作为 UI 图标 "{{emoji}}"，请用 lucide-vue-next 等组件库。' +
            '如果确实需要，加注释 /* emoji 允许 */ 跳过。',
        },
      },

      create(context) {
        const filename = context.filename || context.getFilename?.() || ''

        // 只检查 .vue 和 .tsx/.jsx
        if (!/\.(vue|tsx|jsx)$/.test(filename)) return {}

        return {
          Program() {
            const sourceCode = context.sourceCode
            const source = sourceCode.text
            const lines = source.split('\n')

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]

              // 允许注释行
              if (/^\s*\/\//.test(line)) continue
              if (/^\s*\/\*/.test(line)) continue
              if (/^\s*\*(\s|$)/.test(line)) continue
              if (/^\s*\*\//.test(line)) continue

              // 跳过代码块 / prompt 模板（长行）
              if (line.length > 100) continue

              if (!EMOJI_REGEX.test(line)) continue

              const commentIdx = line.search(/(\/\/|\/\*|\*\/)/)
              if (commentIdx !== -1) {
                const beforeComment = line.substring(0, commentIdx)
                if (!EMOJI_REGEX.test(beforeComment)) continue
              }

              const prevLine = lines[i - 1] || ''
              const nextLine = lines[i + 1] || ''
              if (
                line.includes('emoji 允许') ||
                prevLine.includes('emoji 允许') ||
                nextLine.includes('emoji 允许') ||
                line.includes('allow-emoji') ||
                prevLine.includes('allow-emoji')
              ) continue

              const match = line.match(EMOJI_REGEX)
              const emoji = match ? match[0] : 'emoji'

              context.report({
                loc: { line: i + 1, column: 0, endColumn: line.length },
                messageId: 'forbidden',
                data: { emoji },
              })
            }
          },
        }
      },
    },
  },
}
