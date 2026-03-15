#!/bin/bash
# Cloud Run デプロイ用 GCP リソース初期セットアップスクリプト
# 使い方: PROJECT_ID=your-project-id bash scripts/setup-gcp.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?環境変数 PROJECT_ID を設定してください。例: PROJECT_ID=my-project bash scripts/setup-gcp.sh}"
REGION="asia-northeast1"
REPO="production-planner"
SERVICE="production-planner"
SA_NAME="production-planner"
DATA_BUCKET="${PROJECT_ID}-production-planner-data"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "=== GCP リソースセットアップ ==="
echo "PROJECT_ID : ${PROJECT_ID}"
echo "REGION     : ${REGION}"
echo "DATA_BUCKET: ${DATA_BUCKET}"
echo ""

# 必要な API を有効化
echo "[1/6] API を有効化..."
gcloud services enable \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  storage.googleapis.com \
  --project="${PROJECT_ID}"

# Artifact Registry リポジトリ作成
echo "[2/6] Artifact Registry リポジトリを作成..."
gcloud artifacts repositories create "${REPO}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="Production Planner Docker images" \
  --project="${PROJECT_ID}" || echo "  リポジトリは既に存在します（スキップ）"

# GCS データバケット作成（データ永続化用）
echo "[3/6] GCS データバケットを作成..."
gcloud storage buckets create "gs://${DATA_BUCKET}" \
  --location="${REGION}" \
  --uniform-bucket-level-access \
  --project="${PROJECT_ID}" || echo "  バケットは既に存在します（スキップ）"

# Cloud Run サービスアカウント作成
echo "[4/6] Cloud Run サービスアカウントを作成..."
gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="Production Planner Cloud Run SA" \
  --project="${PROJECT_ID}" || echo "  サービスアカウントは既に存在します（スキップ）"

# GCS バケットへの読み書き権限
echo "[5/6] GCS バケットへのアクセス権を付与..."
gcloud storage buckets add-iam-policy-binding "gs://${DATA_BUCKET}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectUser"

# Cloud Build サービスアカウントへの権限付与
echo "[6/6] Cloud Build への Cloud Run デプロイ権限を付与..."
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/run.admin"

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --project="${PROJECT_ID}"

echo ""
echo "=== セットアップ完了 ==="
echo ""
echo "次のステップ:"
echo ""
echo "1. cloudbuild.yaml の substitutions を更新してください:"
echo "     _SERVICE_ACCOUNT: ${SA_EMAIL}"
echo "     _DATA_BUCKET     : ${DATA_BUCKET}"
echo ""
echo "2. Cloud Build トリガーを GCP コンソールで作成してください"
echo "   ( https://console.cloud.google.com/cloud-build/triggers )"
echo "   - リポジトリ: GitHub の production-planner リポジトリ"
echo "   - ブランチ: ^main$"
echo "   - 設定ファイル: cloudbuild.yaml"
echo "   - substitution variables に以下を設定:"
echo "       _AUTH_JWT_SECRET = （50文字以上のランダム文字列）"
echo "       _GEMINI_API_KEY  = （Gemini API キー）"
echo ""
echo "3. 既存データを GCS にアップロードする場合（任意）:"
echo "   gcloud storage cp ./data/auth-users.json gs://${DATA_BUCKET}/"
echo "   gcloud storage cp ./data/plan.sqlite    gs://${DATA_BUCKET}/"
echo ""
echo "4. JWT シークレット生成のヒント:"
echo "   openssl rand -base64 48"
