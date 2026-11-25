# AI Study 一键部署到腾讯云生产服务器
# 用法: .\.trae\skills\ai-study-deploy\scripts\deploy.ps1 [-SkipBuild] [-Verify]
#   默认：打包 → 上传 → 解压 → 恢复 compose → build + up → 验证 health
#   -SkipBuild：只重启容器不重建镜像（仅改了 .env 或 compose 时用）
#   -Verify：部署后额外跑一次端到端对话验证
#
# 前置: ~/.ssh/deploy-ai-study 存在，服务器 /opt/ai-study/.env 已配置

param(
    [switch]$SkipBuild,
    [switch]$Verify
)

$ErrorActionPreference = "Stop"
$key = "$env:USERPROFILE\.ssh\deploy-ai-study"
$remote = "ubuntu@124.221.233.250"
$projectRoot = "d:\project\ai_study"
$tarPath = "$env:TEMP\ai-study-full.tar.gz"

if (-not (Test-Path $key)) {
    Write-Error "SSH key 不存在: $key"; exit 1
}
if (-not (Test-Path "$projectRoot\docker-compose.prod.yml")) {
    Write-Error "不在项目根目录或缺少 docker-compose.prod.yml: $projectRoot"; exit 1
}

Write-Host "==> [1/5] 打包本地工作区（含未提交改动）..." -ForegroundColor Cyan
Push-Location $projectRoot
tar -czf $tarPath `
  --exclude='.git' --exclude='node_modules' --exclude='.pnpm-store' `
  --exclude='dist' --exclude='.env' --exclude='.env.prod' --exclude='.env.*.local' `
  --exclude='_*.sh' --exclude='_*.json' --exclude='*.log' `
  --exclude='.trae' --exclude='.kiro' --exclude='.vite' --exclude='.nuxt' --exclude='.output' `
  --exclude='data' --exclude='.screenshots' `
  .
Pop-Location
$size = [math]::Round((Get-Item $tarPath).Length / 1MB, 2)
Write-Host "    打包完成: ${size}MB" -ForegroundColor Green

Write-Host "==> [2/5] 上传到服务器..." -ForegroundColor Cyan
scp -i $key -o StrictHostKeyChecking=no $tarPath "${remote}:/tmp/ai-study-full.tar.gz"
Write-Host "    上传完成" -ForegroundColor Green

Write-Host "==> [3/5] 服务器解压覆盖 + 恢复 compose.yml..." -ForegroundColor Cyan
ssh -i $key $remote "cd /opt/ai-study && sudo tar -xzf /tmp/ai-study-full.tar.gz --no-same-owner && sudo cp docker-compose.prod.yml docker-compose.yml && echo 'extracted+compose-restored'"
Write-Host "    解压完成" -ForegroundColor Green

if ($SkipBuild) {
    Write-Host "==> [4/5] 重启容器（不重建镜像）..." -ForegroundColor Cyan
    ssh -i $key $remote "cd /opt/ai-study && sudo docker compose up -d"
} else {
    Write-Host "==> [4/5] 重建镜像 + 启动（可能需要几分钟）..." -ForegroundColor Cyan
    ssh -i $key $remote "cd /opt/ai-study && sudo docker compose up -d --build"
}
Write-Host "    启动完成" -ForegroundColor Green

Write-Host "==> [5/5] 等待容器就绪并验证..." -ForegroundColor Cyan
Start-Sleep -Seconds 20
ssh -i $key $remote "sudo docker ps --format 'table {{.Names}}`t{{.Status}}`t{{.Ports}}'"
$health = ssh -i $key $remote "curl -s http://localhost:3001/api/health"
Write-Host "    Health: $health"
if ($health -match '"status":"ok"') {
    Write-Host "    ✅ 部署成功！前端访问 http://124.221.233.250:3003" -ForegroundColor Green
} else {
    Write-Host "    ❌ Health 检查未通过。查看日志:" -ForegroundColor Red
    Write-Host "    ssh -i $key $remote `"sudo docker logs --tail 30 ai-study-server`""
    exit 1
}

if ($Verify) {
    Write-Host "==> 端到端对话验证..." -ForegroundColor Cyan
    $sid = ssh -i $key $remote "curl -s -X POST http://localhost:3001/api/sessions -H 'Content-Type: application/json' -d '{\"title\":\"deploy-verify\",\"scope\":\"public\"}'" | ConvertFrom-Json | Select-Object -ExpandProperty id
    Write-Host "    sessionId: $sid"
    $reply = ssh -i $key $remote "curl -s -X POST http://localhost:3001/api/chat -H 'Content-Type: application/json' -d '{\"message\":\"用一句话介绍你自己\",\"sessionId\":\"$sid\"}' --max-time 40"
    Write-Host "    回复: $reply"
}
