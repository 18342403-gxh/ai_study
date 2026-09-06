# ========================================
# pgvector 安装脚本（需要管理员权限）
# 右键 → 以管理员身份运行
# ========================================

$ErrorActionPreference = 'Stop'

$src = "$env:TEMP\pgvector-install"
$pgRoot = "D:\PostgreSQL"
$pgLib = "$pgRoot\lib"
$pgShareExt = "$pgRoot\share\extension"

Write-Host "🔍 检查源文件..." -ForegroundColor Cyan
if (-not (Test-Path "$src\lib\vector.dll")) {
    Write-Host "❌ 找不到源文件！重新下载运行安装脚本后再试。" -ForegroundColor Red
    Write-Host "   或者从 https://github.com/andreiramani/pgvector_pgsql_windows/releases/tag/0.8.6_17"
    Write-Host "   下载 vector.v0.8.6-pg17.zip 解压到 $src"
    exit 1
}
Write-Host "✅ 源文件就绪" -ForegroundColor Green

# 停服务
Write-Host "🛑 停止 PostgreSQL..." -ForegroundColor Cyan
try { Stop-Service postgresql-x64-17 -Force -ErrorAction Stop } catch {}
Start-Sleep -Seconds 3

# 复制
Write-Host "📂 复制 vector.dll → lib..." -ForegroundColor Cyan
Copy-Item "$src\lib\vector.dll" "$pgLib\vector.dll" -Force

Write-Host "📂 复制 extension 文件 → share/extension..." -ForegroundColor Cyan
Copy-Item "$src\share\extension\*" "$pgShareExt\" -Force

# 验证
$dll = Test-Path "$pgLib\vector.dll"
$extCount = (Get-ChildItem "$pgShareExt\vector*" -ErrorAction SilentlyContinue).Count
Write-Host "✅ vector.dll: $dll" -ForegroundColor Green
Write-Host "✅ extension files: $extCount" -ForegroundColor Green

# 重启服务
Write-Host "▶️ 启动 PostgreSQL..." -ForegroundColor Cyan
Start-Service postgresql-x64-17
Start-Sleep -Seconds 3

$svc = Get-Service postgresql-x64-17
Write-Host "✅ PostgreSQL: $($svc.Status)" -ForegroundColor Green

# 启用扩展
Write-Host ""
Write-Host "🔧 启用 pgvector 扩展..." -ForegroundColor Cyan
$env:PGPASSWORD = "001230"
$psql = "$pgRoot\bin\psql.exe"
$result = & $psql -U postgres -h localhost -p 5432 -d ai_study -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>&1
Write-Host "   $result"

# 改 chunks 表字段类型
Write-Host "🔧 把 chunks.embedding 从 text 改成 vector(1536)..." -ForegroundColor Cyan
& $psql -U postgres -h localhost -p 5432 -d ai_study -c "ALTER TABLE app.chunks ALTER COLUMN embedding TYPE vector(1536);" 2>&1

# 建 HNSW 索引
Write-Host "🔧 建 HNSW 向量索引..." -ForegroundColor Cyan
& $psql -U postgres -h localhost -p 5432 -d ai_study -c "CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON app.chunks USING hnsw (embedding vector_cosine_ops);" 2>&1

# 验证
Write-Host ""
Write-Host "📊 验证 pgvector..." -ForegroundColor Cyan
$verify = & $psql -U postgres -h localhost -p 5432 -d ai_study -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';" 2>&1
Write-Host $verify -ForegroundColor Green

Write-Host ""
Write-Host "🎉 pgvector 安装完成！" -ForegroundColor Green
Write-Host "   现在可以把 .env 里 DATABASE_DRIVER=postgres 切换 PG 模式了。"
Write-Host ""
