/**
 * ESLint Custom Rule: no-emoji
 * 禁止在 UI 组件源码里用 emoji 当图标。
 *
 * 策略：
 * - 直接扫描源码字符串（不用 AST — vue-eslint-parser 的 template 节点
 *   在 flat config 中不能稳定暴露给自定义 rule visitor）
 * - 只检查 .vue / .tsx / .jsx 文件
 * - 允许 /* emoji 允许 *\/ 或 /* allow-emoji *\/ 注释标记
 * - 允许文档注释、长字符串 > 80 字符（可能是 prompt/代码块）
 */

// emoji 范围
const EMOJI_REGEX = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu

module.exports = {
  rules: {
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

              // 允许注释行（//、/*、* continuation、*/）
              if (/^\s*\/\/\//.test(line)) continue
              if (/^\s*\/\*/.test(line)) continue
              if (/^\s*\*(\s|$)/.test(line)) continue
              if (/^\s*\*\//.test(line)) continue

              // 跳过代码块 / prompt 模板（长行）
              if (line.length > 100) continue

              if (!EMOJI_REGEX.test(line)) continue

              // 检查：emoji 是否只在注释里？
              // 取第一个注释标记前的部分检查
              const commentIdx = line.search(/(\/\/|\/\*|\*\/)/)
              if (commentIdx !== -1) {
                const beforeComment = line.substring(0, commentIdx)
                if (!EMOJI_REGEX.test(beforeComment)) {
                  // emoji 只在注释里，跳过
                  continue
                }
              }

              // 检查上一行或这一行有没有 allow 注释
              const prevLine = lines[i - 1] || ''
              const nextLine = lines[i + 1] || ''
              if (
                line.includes('emoji 允许') ||
                prevLine.includes('emoji 允许') ||
                nextLine.includes('emoji 允许') ||
                line.includes('allow-emoji') ||
                prevLine.includes('allow-emoji')
              ) continue

              // 从这一行为起点报
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
