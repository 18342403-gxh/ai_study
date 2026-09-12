/**
 * Preview Template —— 把 Vue SFC / React TSX 源码转成自包含 HTML
 *
 * 浏览器端运行时编译（零后端打包工具依赖）：
 *   - Vue 3: vue3-sfc-loader (esm.sh CDN) 编译 .vue SFC
 *   - React 18: @babel/standalone + React/ReactDOM UMD (unpkg CDN)
 *   - 统一加 Tailwind CDN（生成代码很可能用 Tailwind 类名）
 *
 * 安全：iframe 用 sandbox="allow-scripts"（无 allow-same-origin，防 XSS 逃逸）
 *       内部 window.onerror 通过 postMessage 通知父窗口
 */

import type { Framework } from './codegen.js'
import { logger } from '../logger.js'
import ts from 'typescript'

// ── CDN 地址常量 ─────────────────────────────────────────────

const CDN = {
  // Vue 3 (ESM) — vue.esm-browser 版本，适合浏览器端
  VUE_ESM: 'https://esm.sh/vue@3.4.38/dist/vue.esm-browser.prod.js',
  // vue3-sfc-loader — 在浏览器端编译 .vue SFC
  SFC_LOADER: 'https://esm.sh/vue3-sfc-loader@0.9.5',

  // React 18 (UMD)
  REACT_UMD: 'https://unpkg.com/react@18/umd/react.production.min.js',
  REACT_DOM_UMD: 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  BABEL_STANDALONE: 'https://unpkg.com/@babel/standalone/babel.min.js',

  // Tailwind CSS (JIT 运行时)
  TAILWIND: 'https://cdn.tailwindcss.com',

  // highlight.js（错误栈里的代码片段）
}

// ── HTML 转义工具 ────────────────────────────────────────────

/**
 * 把源码嵌进 <script> 标签的 JS 字符串里
 * 关键：不能让浏览器 HTML tokenizer 在 JS 字符串里看到 <script 或 </script
 * 否则会中断当前 script 块导致 SyntaxError
 *
 * 方案：用 base64 编码 → JS 里 atob() + decodeURIComponent() 解码
 */
function toSafeJsSource(code: string): { base64: string; decodeExpr: string } {
  // Node.js Buffer 做 UTF-8 base64
  const base64 = Buffer.from(code, 'utf-8').toString('base64')
  // 浏览器端解码：atob 得到 latin1，再 decodeURIComponent(escape()) 转 UTF-8
  const decodeExpr = `decodeURIComponent(escape(atob(${JSON.stringify(base64)})))`
  return { base64, decodeExpr }
}

/**
 * 把 SFC 里的 TypeScript script 块编译成纯 JS
 * vue3-sfc-loader 内置 Babel 但不内置 TS 支持
 * 我们在服务端用 typescript 编译掉 TS 语法，浏览器端就只需处理 JS
 */
function stripTsFromSFC(sfc: string): string {
  // 匹配 <script ... lang="ts" ...>...</script> 块
  // 也匹配 <script setup lang="ts">...</script>
  const scriptBlockRegex = /(<script\b[^>]*\blang\s*=\s*["']ts["'][^>]*>)([\s\S]*?)(<\/script>)/gi

  return sfc.replace(scriptBlockRegex, (_match, openTag: string, tsCode: string, closeTag: string) => {
    // 用 TypeScript compiler API 编译 TS → JS
    const result = ts.transpileModule(tsCode, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      fileName: 'sfc-script.ts',
    })
    const jsCode = result.outputText

    // 把 lang="ts" 从 openTag 里去掉
    const newOpenTag = openTag.replace(/\blang\s*=\s*["']ts["']/gi, '').replace(/<script\s+/, '<script ')
    return newOpenTag + jsCode + closeTag
  })
}

function buildVueHtml(sfcCode: string): string {
  // 先把 TS script 块编译成 JS（vue3-sfc-loader 不内置 TS 支持）
  const sfcWithoutTs = stripTsFromSFC(sfcCode)
  const { decodeExpr } = toSafeJsSource(sfcWithoutTs)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Component Preview</title>
  <script src="${CDN.TAILWIND}"></script>
  <style>
    html, body { margin: 0; padding: 0; min-height: 100vh; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #app { min-height: 100vh; display: flex; align-items: flex-start; justify-content: center; padding: 24px; box-sizing: border-box; }
    .preview-error { padding: 16px; border-radius: 8px; background: #fef2f2; color: #dc2626; font-size: 13px; font-family: ui-monospace, monospace; white-space: pre-wrap; max-width: 720px; }
  </style>
  <script type="importmap">
  {
    "imports": {
      "vue": "${CDN.VUE_ESM}"
    }
  }
  </script>
</head>
<body>
  <div id="app"></div>

  <script>
  // 全局错误捕获 → postMessage 给父窗口
  window.addEventListener('error', function(e) {
    parent && parent.postMessage({ type: 'preview-error', message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno }, '*')
    const el = document.getElementById('app')
    if (el) {
      el.innerHTML = '<div class="preview-error">❌ ' + (e.message || 'Unknown error') + (e.lineno ? '\\nLine ' + e.lineno : '') + '</div>'
    }
  })
  window.addEventListener('unhandledrejection', function(e) {
    parent && parent.postMessage({ type: 'preview-error', message: String(e.reason), unhandled: true }, '*')
  })
  </script>

  <script type="module">
    import * as Vue from 'vue'
    import { loadModule } from '${CDN.SFC_LOADER}'

    // vue3-sfc-loader 用假路径加载（它不接受源码字符串）
    const ENTRY = '/__preview__/main.vue'
    const moduleCache = { vue: Vue }

    const sfcCode = ${decodeExpr}

    try {
      const comp = await loadModule(ENTRY, {
        moduleCache,
        async getFile(url) {
          // ENTRY 假路径返回实际 SFC 源码
          if (url === ENTRY) return sfcCode
          // 其他路径一律不支持（只能 import from "vue" 这种 bare specifier）
          throw new Error('外部模块未支持: ' + url)
        },
        // vue3-sfc-loader 编译 SFC 里的 <style scoped> 后会调用这个函数
        addStyle: (textContent) => {
          const style = document.createElement('style')
          style.textContent = textContent
          document.head.appendChild(style)
        },
      })
      const app = Vue.createApp(comp.default || comp)
      app.mount('#app')
    } catch (err) {
      const msg = err?.message || String(err)
      const stack = err?.stack || ''
      parent && parent.postMessage({ type: 'preview-error', message: msg, stack, phase: 'sfc-compile' }, '*')
      document.getElementById('app').innerHTML = '<div class="preview-error">⚠️ ' + msg + '\\n\\n' + stack + '</div>'
    }
  </script>
</body>
</html>`
}

// ── React TSX 模板 ──────────────────────────────────────────

function buildReactHtml(tsxCode: string): string {
  // React 代码里大概率有 `import React from 'react'` / `import { useState } from 'react'`
  // Babel standalone 只负责转译语法，不会处理 import。UMD 全局有 React，所以把 import 行去掉即可
  const strippedCode = tsxCode
    .replace(/^\s*import\s+React[^;]*;\s*$/gm, '')          // import React, { useState } from 'react'
    .replace(/^\s*import\s*\{[^}]*\}[^;]*;\s*$/gm, '')      // import { useState } from 'react'
    .replace(/^\s*import\s+type\s+\{[^}]*\}[^;]*;\s*$/gm, '')  // import type { Props } from 'react'
    .replace(/^\s*import[^'";]*['"][^'";]+['"];\s*$/gm, '')  // 其他 import ... from '...'

  const { decodeExpr } = toSafeJsSource(strippedCode)

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Component Preview</title>
  <script src="${CDN.TAILWIND}"></script>
  <style>
    html, body { margin: 0; padding: 0; min-height: 100vh; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #root { min-height: 100vh; display: flex; align-items: flex-start; justify-content: center; padding: 24px; box-sizing: border-box; }
    .preview-error { padding: 16px; border-radius: 8px; background: #fef2f2; color: #dc2626; font-size: 13px; font-family: ui-monospace, monospace; white-space: pre-wrap; max-width: 720px; }
  </style>
  <script crossorigin src="${CDN.REACT_UMD}"></script>
  <script crossorigin src="${CDN.REACT_DOM_UMD}"></script>
  <script src="${CDN.BABEL_STANDALONE}"></script>
</head>
<body>
  <div id="root"></div>

  <script>
  // 全局错误捕获 → postMessage 给父窗口
  window.addEventListener('error', function(e) {
    parent && parent.postMessage({ type: 'preview-error', message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno }, '*')
    const el = document.getElementById('root')
    if (el) {
      el.innerHTML = '<div class="preview-error">❌ ' + (e.message || 'Unknown error') + (e.lineno ? '\\nLine ' + e.lineno : '') + '</div>'
    }
  })
  window.addEventListener('unhandledrejection', function(e) {
    parent && parent.postMessage({ type: 'preview-error', message: String(e.reason), unhandled: true }, '*')
  })
  </script>

  <script>
    const reactCode = ${decodeExpr}

    try {
      // Babel standalone 转译 TSX → JS（React UMD 全局已注入）
      const transpiled = Babel.transform(reactCode, {
        presets: ['react', 'typescript'],
        filename: 'Component.tsx',
      }).code

      // 包装：把组件挂载到 #root（假设导出了 default，或者是第一个 const 组件）
      const wrapped = transpiled + \`

// 自动挂载：尝试找默认导出的组件
if (typeof Component !== 'undefined') {
  const el = React.createElement(Component)
  const rootEl = document.getElementById('root')
  if (ReactDOM.createRoot) {
    ReactDOM.createRoot(rootEl).render(el)
  } else {
    ReactDOM.render(el, rootEl)
  }
} else if (typeof defaultExport !== 'undefined') {
  const el = React.createElement(defaultExport)
  const rootEl = document.getElementById('root')
  if (ReactDOM.createRoot) {
    ReactDOM.createRoot(rootEl).render(el)
  } else {
    ReactDOM.render(el, rootEl)
  }
} else if (typeof exports !== 'undefined' && exports.default) {
  const el = React.createElement(exports.default)
  ReactDOM.createRoot(document.getElementById('root')).render(el)
}
\`

      // eslint-disable-next-line no-new-func
      new Function('React', 'ReactDOM', wrapped)(React, ReactDOM)
    } catch (err) {
      const msg = err?.message || String(err)
      parent && parent.postMessage({ type: 'preview-error', message: msg, phase: 'babel-transform' }, '*')
      document.getElementById('root').innerHTML = '<div class="preview-error">⚠️ 编译失败: ' + msg + '</div>'
    }
  </script>
</body>
</html>`
}

// ── 公共入口 ────────────────────────────────────────────────

export function buildPreviewHtml(code: string, framework: Framework): string {
  logger.debug('preview.template', 'buildPreviewHtml', { framework, codeLen: code.length })
  if (framework === 'vue') return buildVueHtml(code)
  return buildReactHtml(code)
}
