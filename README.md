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

## Windows 向け簡易起動

`run.bat` をダブルクリックまたは PowerShell から実行すると、依存関係の導入後に開発サーバーを起動します。

```powershell
.\run.bat
```

エラーが発生した場合は、`pause` により画面が止まるのでメッセージを確認してください。

## ディレクトリ構成

```
.
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
