#!/bin/bash
# 初始化 git hooks
# 执行一次即可：bash scripts/setup-hooks.sh

HOOK_DIR=".git/hooks"
PRE_COMMIT="$HOOK_DIR/pre-commit"

echo "配置 git pre-commit hook..."

cat > "$PRE_COMMIT" << 'EOF'
#!/bin/bash
# 由 scripts/setup-hooks.sh 生成
# 提交前执行代码质量检查
bash scripts/pre-commit.sh
EOF

chmod +x "$PRE_COMMIT"
echo "✓ pre-commit hook 已配置"
echo "  之后每次 git commit 会自动执行代码检查"
