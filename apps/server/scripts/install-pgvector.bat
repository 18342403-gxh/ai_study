@echo off
REM ========================================
REM pgvector 一键安装（PG 17 + Windows）
REM 右键 → 以管理员身份运行
REM ========================================

set "PG_ROOT=D:\PostgreSQL"
set "PG_BIN=%PG_ROOT%\bin"
set "PG_LIB=%PG_ROOT%\lib"
set "PG_EXT=%PG_ROOT%\share\extension"
set "SRC=%USERPROFILE%\Desktop\pgvector-install"
set "PGPASSWORD=001230"
set "PSQL=%PG_BIN%\psql.exe"

echo 🔍 检查源文件...
if not exist "%SRC%\lib\vector.dll" (
    echo ❌ 找不到 %SRC%\lib\vector.dll
    echo    先让 AI 把 pgvector 复制到桌面再运行
    pause
    exit /b 1
)
echo ✅ 源文件就绪

echo.
echo 🛑 停止 PostgreSQL...
net stop postgresql-x64-17 >nul 2>&1
timeout /t 3 /nobreak >nul

echo.
echo 📂 复制 vector.dll → %PG_LIB%...
copy /Y "%SRC%\lib\vector.dll" "%PG_LIB%\vector.dll"
echo 📂 复制 extension → %PG_EXT%...
xcopy /Y /E /I "%SRC%\extension" "%PG_EXT%"

echo.
echo ✅ 文件复制完成

echo.
echo ▶️ 启动 PostgreSQL...
net start postgresql-x64-17
timeout /t 3 /nobreak >nul

echo.
echo 🔧 创建 pgvector 扩展...
"%PSQL%" -U postgres -h localhost -p 5432 -d ai_study -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo.
echo 🔧 改 chunks.embedding 类型...
"%PSQL%" -U postgres -h localhost -p 5432 -d ai_study -c "ALTER TABLE app.chunks ALTER COLUMN embedding TYPE vector(1536);"

echo.
echo 🔧 建 HNSW 向量索引...
"%PSQL%" -U postgres -h localhost -p 5432 -d ai_study -c "CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON app.chunks USING hnsw (embedding vector_cosine_ops);"

echo.
echo 📊 验证...
"%PSQL%" -U postgres -h localhost -p 5432 -d ai_study -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"

echo.
echo 🎉 完成！
echo    现在可以在 .env 里把 DATABASE_DRIVER 改成 postgres 切换模式了。
pause
