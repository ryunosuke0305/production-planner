# production-planner

製造計画ガントチャート（React + Vite）の動作サンプルです。ドラッグ＆ドロップでブロック移動・リサイズ、レシピ編集、日次在庫表示、JSONエクスポートに対応しています。

## 必要環境

- Node.js（LTS 推奨）
- npm

## セットアップと起動（共通）

```bash
npm install
npm run dev
```

起動後、ターミナルに表示される URL（例: `http://localhost:5173`）へアクセスしてください。

## Docker での起動（単一コンテナ）

永続化データは `data/` をバインドマウントしてください（`plan.json` などが保存されます）。

```bash
docker build -t production-planner .
docker run --rm -p 4173:4173 -v "$(pwd)/data:/app/data" production-planner
```

起動後、`http://localhost:4173` へアクセスしてください。

## Windows 向け簡易起動

`run.bat` をダブルクリックまたは PowerShell から実行すると、依存関係の導入後に開発サーバーを起動します。

```powershell
.\run.bat
```

エラーが発生した場合は、`pause` により画面が止まるのでメッセージを確認してください。

## データ保存について

- 画面上の計画データは開発サーバー経由で `data/plan.json` に保存され、再読み込みしても保持されます。
- `.env` は `data/` ディレクトリにまとめて配置してください（例: `data/.env`）。

## ディレクトリ構成

```
.
├─ data/                 # 永続データ置き場（.env / plan.json もここに配置）
├─ src/
│  ├─ App.tsx             # 製造計画ガントチャートの本体
│  ├─ main.tsx            # エントリポイント
│  └─ components/ui/      # UI部品（簡易実装）
├─ run.bat                # Windows用起動スクリプト
└─ README.md
```

## 補足

- `JSONエクスポート` ボタンで、週・スロット情報を含む JSON をダウンロードします。
- UI 部品は最小限の実装です。必要に応じてデザインや機能を拡張してください。
