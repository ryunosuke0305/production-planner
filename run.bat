@echo off
chcp 65001 >nul
setlocal enableextensions enabledelayedexpansion

cd /d "%~dp0"

echo [INFO] Node.js / npm を確認中...
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm が見つかりません。Node.js をインストールしてください。
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%a in ('node -p "process.versions.node"') do set NODE_MAJOR=%%a
if not defined NODE_MAJOR (
  echo [ERROR] Node.js のバージョン取得に失敗しました。
  pause
  exit /b 1
)

if %NODE_MAJOR% LSS 20 (
  echo [ERROR] Node.js のバージョンが古すぎます。LTS の 20.x または 22.x を使用してください。
  echo [ERROR] 現在のバージョン: v%NODE_MAJOR%.x
  pause
  exit /b 1
)

if %NODE_MAJOR% GTR 22 (
  echo [ERROR] Node.js v%NODE_MAJOR%.x は better-sqlite3 の事前ビルドが無く、
  echo [ERROR] Visual Studio の C++ ビルド環境が必要になります。
  echo [ERROR] LTS の 20.x または 22.x を使用してください。
  pause
  exit /b 1
)

echo [INFO] 依存関係をインストールします...
call npm install
if errorlevel 1 goto :error

echo [INFO] 開発サーバーを起動します...
call npm run dev
if errorlevel 1 goto :error

goto :end

:error
echo.
echo [ERROR] 処理中にエラーが発生しました。終了コード: %errorlevel%
echo [ERROR] ログを確認して原因を特定してください。
pause
exit /b %errorlevel%

:end
echo.
echo [INFO] 終了しました。
pause
exit /b 0
