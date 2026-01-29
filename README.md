# production-planner

製造計画ガントチャート（React + Vite）の動作サンプルです。ドラッグ＆ドロップでブロック移動・リサイズ、レシピ編集、日次在庫表示、JSONエクスポート、チャットによる計画更新に対応しています。

## 主な機能

- ガントチャートの週表示（1時間 / 2時間 / 日単位）
- 初期表示は現在の日付を起点にした今週分を表示
- ブロックの追加、移動（上下に日をまたいで移動可能）、リサイズ、メモ編集（承認済みブロックは移動・リサイズ不可）
- ブロック移動は勤務時間内に制限（ドラッグ開始位置を維持）
- 原料・品目マスタの編集（マスタ管理の子ページで一覧を表示）
- 品目/原料の選択は検索可能な入力欄で絞り込み
- 日次在庫と原料消費量の計算表示
- 計画データの JSON エクスポート
- 目的別マニュアル（一般利用者向け / システム管理者向け）
- Gemini API を使ったチャット更新（任意）
- Gemini チャットの条件設定で、送信対象の計画日数を指定（デフォルト30日）
- Gemini チャット送信前に、指定日数へ合わせて計画カレンダーを自動拡張し、範囲外の startSlot は警告表示
- Gemini への送信時、チャット履歴は直近1週間分のみを含める
- Gemini へ送信する計画データは「過去1週間〜指定日数先」の範囲に絞り、実行日時（ISO形式）も併せて送信

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
- 品目マスタで入力した品目コード（品目ID）は SQLite に保存され、日別在庫の照合に利用されます。
- Excel取り込み画面のヘッダー指定（任意）も SQLite に保存され、再読み込みしても保持されます。
- 既存の `data/plan.json` を SQLite に移行する場合は `npm run migrate:plan` を実行してください（再実行しても最新の内容で上書きされます）。
- `.env` は `data/` ディレクトリにまとめて配置してください（例: `data/.env`）。
- `GEMINI_API_KEY` を設定するとチャット機能が利用できます。モデルを変えたい場合は `GEMINI_MODEL` または `VITE_GEMINI_MODEL` を設定してください。

## 認証設定（ID/パスワード）

Cloud Run など社外アクセスが必要な運用を想定し、ID/パスワードによる基本認証とロール管理を追加しています。

- 認証ユーザーは `data/auth-users.json` に定義します。
- ひな形は `data/auth-users.example.json` にあります。コピーして編集してください。

```bash
cp data/auth-users.example.json data/auth-users.json
```

### ユーザー定義の例

```json
{
  "users": [
    { "id": "admin", "name": "管理者", "role": "admin", "passwordHash": "scrypt$..." },
    { "id": "viewer", "name": "閲覧者", "role": "viewer", "passwordHash": "scrypt$..." }
  ]
}
```

- `role` は `admin`（編集可）または `viewer`（閲覧専用）。
- `viewer` はブロックの追加/移動/リサイズ、承認、保存/削除、JSONエクスポートなどの操作が無効化されます。
- ログイン後のセッションは `auth_session` Cookie に署名付きJWTとして保存されます（期限付き）。
- JWT の署名鍵は `AUTH_JWT_SECRET`（例: `data/.env`）で設定してください。
- 管理者は「マスタ管理 → ユーザー管理」からユーザーの追加・更新・削除が行えます（変更内容は `data/auth-users.json` に保存されます）。
- ユーザー管理画面から追加・更新するパスワードはサーバー側で scrypt ハッシュ化されます。

### パスワードハッシュの作成

`passwordHash` は scrypt で作成します。ユーザー管理画面を使わずに直接編集する場合は、以下のコマンドで生成できます。

```bash
node -e "const crypto=require('crypto');const hash=(pw)=>{const salt=crypto.randomBytes(16);const key=crypto.scryptSync(pw,salt,64);return ['scrypt',salt.toString('base64'),key.toString('base64')].join('$');};console.log(hash('your_password'));"
```

## 長期運用（10年）に向けた設計方針

- 週移動で表示範囲が変わった際、計画カレンダーの日付範囲を前後に自動拡張します（将来週の入力を阻害しない設計）。  
- 日付の計算は ISO 形式（`YYYY-MM-DD`）と日数差分で扱い、月跨ぎ・年跨ぎでもズレないようにしています。
- 長期運用でデータが増加するため、`data/plan.sqlite` のバックアップを継続的に行ってください。

## Excel取り込み

Excel取り込みタブから `.xlsx` / `.xls` / `.csv` をアップロードすると、日別在庫・品目マスタ・原料マスタを更新できます。読み込み対象は **先頭シート** のみで、1行目をヘッダーとして判定します。
ヘッダー名が異なる場合は、ヘッダー指定欄に候補名を入力して「設定を保存」を押すことで、次回以降も同じ候補で判定できます。

### 日別在庫（必要列）

- 日付（例: `日付`, `年月日`, `date`, `stockdate`, `inventorydate`）
- 品目コード（例: `品目コード`, `品目`, `itemcode`, `item_code`, `itemid`, `item_id`）
- 在庫数（例: `在庫数`, `在庫`, `stock`, `inventory`, `qty`）

取り込み時に品目マスタに存在しない品目コードはスキップされます。無効な行がある場合は件数が表示されます。
任意で「出荷数（例: `出荷数`, `出荷`, `shipped`, `shipment`, `shipqty`, `ship_qty`）」も取り込めます。

### 品目マスタ（必要列）

- 品目コード（例: `品目コード`, `コード`, `itemcode`, `item_code`, `itemid`, `item_id`）
- 品目名（例: `品目名`, `品名`, `name`, `itemname`, `item_name`）

任意で「単位 / 計画方針 / 安全在庫 / 安全在庫自動計算 / 安全在庫参照日数 / 安全在庫係数 / 賞味期限日数 / 製造効率 / 包装効率 / 備考」も取り込めます。品目コードをキーに既存マスタを上書きし、新規コードは追加されます（未掲載の品目は削除されません）。
単位は「ピース / ケース / セット / kg / 袋 / 枚 / 個 / 箱」から選択します。

### 原料マスタ（必要列）

- 原料コード（例: `原料コード`, `コード`, `materialcode`, `material_code`, `materialid`, `material_id`）
- 原料名（例: `原料名`, `名称`, `name`, `material`, `materialname`, `material_name`）

任意で「単位」も取り込めます。原料コードをキーに既存マスタを上書きし、新規コードは追加されます（未掲載の原料は削除されません）。
原料の単位も同じリストから選択します。

## マニュアル

画面の「マニュアル」メニューから、一般利用者向けとシステム管理者向けの操作手順を確認できます。本文は `data/` 配下の Markdown ファイルで管理しています。

- `data/manual-user.md`
- `data/manual-admin.md`

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

### `/api/daily-stocks`（Vite ミドルウェア）

Excel取り込みで更新する日別在庫の保存先です。アップロード時に全件上書きします。
`entries` には在庫数に加えて出荷数（`shipped`）も含めます。

| メソッド | 説明 | 入出力 |
| --- | --- | --- |
| GET | 日別在庫を取得 | `updatedAtISO` と `entries` を返却 |
| POST | 日別在庫を保存 | `entries` を受け取り全件置換 |

### `/api/gemini`（Vite ミドルウェア）

Gemini API との通信をサーバー側で中継し、クライアントに API キーを渡さないためのエンドポイントです。

| メソッド | 説明 |
| --- | --- |
| POST | チャット更新のリクエストを中継 |

`data/.env` に `GEMINI_API_KEY` を設定しておく必要があります。

### Gemini API

チャット更新はサーバー側の `/api/gemini` ミドルウェアを経由して `@google/genai` SDK で Gemini API を呼び出し、返却された JSON から更新アクションを抽出します。API キーはサーバー環境変数（`GEMINI_API_KEY`）で管理し、クライアントには公開しません。
送信するメッセージは「現在の計画データ(JSON) → ユーザー入力 → ユーザー制約条件」の順で構成し、ブロックの作成・移動時には割り当て理由を `memo` に残すよう指示しています。

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

## 品質チェックメモ

- フォーム系 UI（Input / Textarea / Select）の見た目は `src/components/ui/form-control.ts` に集約し、重複したクラス定義を避けています。
- フォーム系のスタイル変更は `formControlBase` を起点に行うことで、UI の統一感を保てます。

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
      "publicId": "ITEM-001",
      "name": "Item A",
      "unit": "ケース",
      "planningPolicy": "make_to_stock",
      "safetyStock": 20,
      "shelfLifeDays": 30,
      "productionEfficiency": 40,
      "notes": "定番商品のため平準化。",
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
items(id TEXT PRIMARY KEY, public_id TEXT, name TEXT, unit TEXT, planning_policy TEXT, safety_stock REAL, shelf_life_days REAL, production_efficiency REAL, notes TEXT)
item_recipes(item_id TEXT, material_id TEXT, per_unit REAL, unit TEXT, PRIMARY KEY(item_id, material_id))
blocks(id TEXT PRIMARY KEY, item_id TEXT, start INTEGER, len INTEGER, amount REAL, memo TEXT)
daily_stocks(date TEXT, item_id TEXT, item_code TEXT, stock REAL, shipped REAL, PRIMARY KEY(date, item_id))
```

#### インデックス方針

- 期間検索: `blocks(start)`（スロット範囲の検索に使用）
- 品目検索: `blocks(item_id)`
- 期間 + 品目の複合検索: `blocks(item_id, start)`
- 日別在庫の期間検索: `daily_stocks(date)`
- 日別在庫の品目検索: `daily_stocks(item_id)`

### JSON エクスポート（`ExportPayloadV1`）

`JSONエクスポート` ボタンで出力される構造です。AI 連携や外部システム連携向けに、スロットラベル等のメタ情報を含めています。

```json
{
  "schemaVersion": "1.2.2",
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
      "unit": "ケース",
      "shelfLifeDays": 30,
      "productionEfficiency": 40,
      "notes": "定番商品のため平準化。",
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
ブロックを作成・移動する場合は、割り当ての根拠を `memo` に残します。

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
