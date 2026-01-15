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

永続化データは `data/` をバインドマウントしてください（`plan.sqlite` が保存されます）。

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

- 画面上の計画データは開発サーバー経由で `data/plan.sqlite` に保存され、再読み込みしても保持されます。
- 既存の `data/plan.json` を SQLite に移行する場合は `npm run migrate:plan` を実行してください（再実行しても最新の内容で上書きされます）。
- `.env` は `data/` ディレクトリにまとめて配置してください（例: `data/.env`）。
- `GEMINI_API_KEY` を設定するとチャット機能が利用できます。モデルを変えたい場合は `GEMINI_MODEL` または `VITE_GEMINI_MODEL` を設定してください。

## Gemini 接続設定（Quickstart準拠）

Gemini API のキー作成手順は Google の Quickstart に準拠しています。詳細は以下を参照してください。

- https://ai.google.dev/gemini-api/docs/quickstart?hl=ja#javascript

`data/.env` に API キーを保存すると、サーバー側の `/api/gemini` が Gemini API と通信します。

```bash
cp data/.env.example data/.env
```

```env
GEMINI_API_KEY=your_api_key_here
# GEMINI_MODEL=gemini-2.5-flash
# VITE_GEMINI_MODEL=gemini-2.5-flash
```

- `GEMINI_API_KEY` はサーバー側でのみ使用され、クライアントには公開されません。
- `GEMINI_MODEL` はサーバー側のデフォルトモデルを上書きします。
- `VITE_GEMINI_MODEL` はクライアント側が送信するモデル指定を上書きします。

## API とデータフロー

### `/api/plan`（Vite ミドルウェア）

開発サーバー/プレビューサーバーに組み込まれた簡易 API です。`data/plan.sqlite` を読み書きします。

| メソッド | 説明 | 入出力 |
| --- | --- | --- |
| GET | 計画データを取得（条件付き検索可） | 204（未保存時）または JSON |
| POST | 計画データを保存 | JSON を受け取り `data/plan.sqlite` に保存 |

#### GET クエリパラメータ

- `from`: 取得開始日（`YYYY-MM-DD`）
- `to`: 取得終了日（`YYYY-MM-DD`）
- `itemId`: 品目 ID でブロックを絞り込み
- `itemName`: 品目名（部分一致・小文字化）でブロックを絞り込み

### `/api/gemini`（Vite ミドルウェア）

Gemini API との通信をサーバー側で中継し、クライアントに API キーを渡さないためのエンドポイントです。

| メソッド | 説明 |
| --- | --- |
| POST | チャット更新のリクエストを中継 |

`data/.env` に `GEMINI_API_KEY` を設定しておく必要があります。

### Gemini API

チャット更新はサーバー側の `/api/gemini` ミドルウェアを経由して Google Generative Language API に `POST` し、返却された JSON から更新アクションを抽出します。API キーはサーバー環境変数（`GEMINI_API_KEY`）で管理し、クライアントには公開しません。

## ディレクトリ構成

```
.
├─ data/                 # 永続データ置き場（.env / plan.sqlite もここに配置）
├─ scripts/              # SQLite 移行スクリプトなど
├─ src/
│  ├─ App.tsx             # 製造計画ガントチャートの本体
│  ├─ main.tsx            # エントリポイント
│  └─ components/ui/      # UI部品（簡易実装）
├─ run.bat                # Windows用起動スクリプト
└─ README.md
```

## データスキーマ

### 計画保存データ（`/api/plan`）

API でやり取りする JSON は従来と同じ構造で、保存先は SQLite です。

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

### SQLite スキーマ（`data/plan.sqlite`）

```
meta(key TEXT PRIMARY KEY, value TEXT)
materials(id TEXT PRIMARY KEY, name TEXT, unit TEXT)
items(id TEXT PRIMARY KEY, name TEXT, unit TEXT, stock REAL)
item_recipes(item_id TEXT, material_id TEXT, per_unit REAL, unit TEXT, PRIMARY KEY(item_id, material_id))
blocks(id TEXT PRIMARY KEY, item_id TEXT, start INTEGER, len INTEGER, amount REAL, memo TEXT)
```

#### インデックス方針

- 期間検索: `blocks(start)`（スロット範囲の検索に使用）
- 品目検索: `blocks(item_id)`
- 期間 + 品目の複合検索: `blocks(item_id, start)`

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
