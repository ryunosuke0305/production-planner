# production-planner

製造計画ガントチャート（React + Vite）の動作サンプルです。ドラッグ＆ドロップでブロック移動・リサイズ、レシピ編集、日次在庫表示、JSONエクスポート、チャットによる計画更新に対応しています。

## 主な機能

- ガントチャートの週表示（1時間 / 2時間 / 日単位）
- ブロックの追加、移動、リサイズ、メモ編集
- 原料・品目マスタの編集（レシピ含む）
- 日次在庫と原料消費量の計算表示
- 計画データの JSON エクスポート
- Gemini API を使ったチャット更新（任意）

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
- `VITE_GEMINI_API_KEY` と `VITE_GEMINI_MODEL` を設定するとチャット機能が利用できます（未設定時はUI上で案内メッセージを表示します）。

## API とデータフロー

### `/api/plan`（Vite ミドルウェア）

開発サーバー/プレビューサーバーに組み込まれた簡易 API です。`data/plan.json` を読み書きします。

| メソッド | 説明 | 入出力 |
| --- | --- | --- |
| GET | 計画データを取得 | 204（未保存時）または JSON |
| POST | 計画データを保存 | JSON を受け取り `data/plan.json` に保存 |

### Gemini API

チャット更新は Google Generative Language API に `POST` し、返却された JSON から更新アクションを抽出します。API とのやり取りはクライアントから直接行われるため、公開環境では API キー管理に注意してください。

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

## データスキーマ

### 計画保存データ（`/api/plan`）

`data/plan.json` に保存されるデータの最小構造です。

```json
{
  "version": 1,
  "weekStartISO": "2026-01-12",
  "density": "hour",
  "materials": [
    { "id": "MAT-A", "name": "原料A", "unit": "kg" }
  ],
  "items": [
    {
      "id": "A",
      "name": "Item A",
      "unit": "cs",
      "stock": 140,
      "recipe": [
        { "materialId": "MAT-A", "perUnit": 0.25, "unit": "kg" }
      ]
    }
  ],
  "blocks": [
    { "id": "b_xxx", "itemId": "A", "start": 1, "len": 2, "amount": 40, "memo": "" }
  ]
}
```

- `density`: `"hour" | "2hour" | "day"`
- `start`: 0 始まりのスロット番号
- `len`: スロット長（`density` に依存）

### JSON エクスポート（`ExportPayloadV1`）

`JSONエクスポート` ボタンで出力される構造です。AI 連携や外部システム連携向けに、スロットラベル等のメタ情報を含めています。

```json
{
  "schemaVersion": "1.0.0",
  "meta": {
    "exportedAtISO": "2026-01-14T00:00:00.000Z",
    "timezone": "Asia/Tokyo",
    "weekStartISO": "2026-01-12",
    "horizonDays": 7,
    "density": "hour",
    "slotsPerDay": 10,
    "slotCount": 70,
    "weekDates": ["2026-01-12"],
    "hours": [8, 9, 10],
    "slotIndexToLabel": ["1/12 8:00"]
  },
  "items": [
    {
      "id": "A",
      "name": "Item A",
      "unit": "cs",
      "stock": 140,
      "recipe": [
        {
          "materialId": "MAT-A",
          "materialName": "原料A",
          "perUnit": 0.25,
          "unit": "kg"
        }
      ]
    }
  ],
  "materials": [
    { "id": "MAT-A", "name": "原料A", "unit": "kg" }
  ],
  "blocks": [
    {
      "id": "b_xxx",
      "itemId": "A",
      "start": 1,
      "len": 2,
      "startLabel": "1/12 9:00",
      "endLabel": "1/12 10:00",
      "amount": 40,
      "memo": ""
    }
  ],
  "constraints": {}
}
```

### チャット更新アクション

Gemini API には以下の形式で更新指示を返すように指示しています。

```json
{
  "summary": "更新内容の短い説明",
  "actions": [
    {
      "type": "create_block",
      "blockId": "既存ブロックID",
      "itemId": "A",
      "itemName": "Item A",
      "startSlot": 10,
      "startLabel": "1/12 10:00",
      "len": 2,
      "amount": 40,
      "memo": "段取り注意"
    }
  ]
}
```

## 補足

- `JSONエクスポート` ボタンで、週・スロット情報を含む JSON をダウンロードします。
- UI 部品は最小限の実装です。必要に応じてデザインや機能を拡張してください。
