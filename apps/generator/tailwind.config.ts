/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './components/**/*.{vue,js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './composables/**/*.{js,ts}',
    './plugins/**/*.{js,ts}',
    './app.vue',
  ],
  theme: {
    extend: {
      colors: {
        // 主色：介于深蓝和浅蓝之间的中等蓝
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6', // 主色
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // 深色显示区配色
        surface: {
          900: '#0b1120',  // 显示区背景
          800: '#111827',  // 次级深色
          700: '#1e293b',  // 边框深色
          600: '#334155',
        },
        // 侧边栏
        sidebar: {
          bg: '#f8fafc',
          border: '#e2e8f0',
          active: '#dbeafe',
          activeText: '#1d4ed8',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
