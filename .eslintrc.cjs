/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: { browser: true, es2021: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    // ===== TypeScript 严格规则 =====
    // 禁止 any 类型
    '@typescript-eslint/no-explicit-any': 'error',
    // 禁止未使用的变量
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

    // ===== React Hooks 规则 =====
    // useEffect 依赖数组必须完整
    'react-hooks/exhaustive-deps': 'warn',
    // Hooks 调用规则
    'react-hooks/rules-of-hooks': 'error',

    // ===== 代码质量 =====
    // 禁止 console.log（生产环境）
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    // 禁止 debugger
    'no-debugger': 'error',
    // 禁止空 catch
    'no-empty': 'error',
    // 允许 while(true) 用于流式读取循环
    'no-constant-condition': ['error', { checkLoops: false }],
    // 要求使用 === 而非 ==
    'eqeqeq': ['error', 'always'],
    // 禁止 var，使用 let/const
    'no-var': 'error',
    // 优先使用 const
    'prefer-const': 'warn',

    // ===== 复杂度控制 =====
    // 函数最大行数（组件含 JSX 适当放宽到 120）
    'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
    // 嵌套深度不超过 4 层（流式解析需要 while > for > if）
    'max-depth': ['warn', 4],
    // 函数参数不超过 4 个
    'max-params': ['warn', 4],
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.config.*', '.eslintrc.cjs'],
}
