#!/bin/bash
# pre-commit 钩子脚本
# 提交前自动执行代码质量检查，确保代码符合规范

set -e

echo "🔍 执行代码质量检查..."
echo ""

# 1. ESLint 检查
echo "  [1/3] ESLint 代码规范检查..."
npx eslint src/ --ext .ts,.tsx --max-warnings 5
echo "  ✓ ESLint 通过"
echo ""

# 2. TypeScript 编译检查
echo "  [2/3] TypeScript 类型检查..."
npx tsc --noEmit
echo "  ✓ TypeScript 通过"
echo ""

# 3. 禁止提交调试代码检查
echo "  [3/3] 调试代码残留检查..."
ISSUES=""

# 检查 console.log（排除注释中的）
if grep -rn "console\.log" src/ --include="*.ts" --include="*.tsx" | grep -v "^.*//.*console\.log" | grep -v "node_modules" > /dev/null 2>&1; then
  ISSUES="$ISSUES\n  ❌ 发现 console.log 调试代码"
fi

# 检查硬编码 localhost
if grep -rn "localhost" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "// " > /dev/null 2>&1; then
  ISSUES="$ISSUES\n  ❌ 发现硬编码 localhost 地址"
fi

# 检查硬编码 API Key 模式（长字符串可能是 key）
if grep -rn "sk-[a-zA-Z0-9]\{20,\}" src/ --include="*.ts" --include="*.tsx" > /dev/null 2>&1; then
  ISSUES="$ISSUES\n  ❌ 发现疑似硬编码 API Key"
fi

if [ -n "$ISSUES" ]; then
  echo -e "$ISSUES"
  echo ""
  echo "  请修复以上问题后再提交"
  exit 1
fi
echo "  ✓ 无调试代码残留"
echo ""

echo "✅ 所有检查通过，可以提交"
