@echo off
setlocal enableextensions enabledelayedexpansion

cd /d "%~dp0"

echo [INFO] Node.js / npm を確認中...
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm が見つかりません。Node.js をインストールしてください。
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
