# Calendar Notifier

日本の主要セールを、根拠つきの公開 `.ics` フィードとして配信する MVP 実装です。公開面、購読フィード、内部審査画面、巡回処理、証拠保管を 1 つの Node.js サービスとして扱います。

## ローカル開発

```bash
npm install
cp .env.example .env
npm run seed
npm run dev
```

`npm run seed` は monitor 定義を idempotent に投入します。`ADMIN_PASSWORD` は必ず変更してください。

ローカル既定値:

- DB: `SQLite`
- storage: `./storage`
- base URL: `http://localhost:3000`

利用できるコマンド:

```bash
npm run dev
npm run build
npm run start
npm run test
npm run crawl
npm run crawl:due
npm run worker
npm run seed
```

`npm run crawl` は全 monitor を 1 回処理します。`npm run crawl:due` は JST の現在時刻に応じた bucket だけを処理します。手動で bucket を切り替える場合は `CRAWL_BUCKET=rule|content|all npm run crawl:due` を使います。`npm run worker` はローカル補助用です。

## 本番構成

本番の正は次の構成です。

- Web アプリ: Render Web Service
- DB: Render Postgres
- 証拠保存: Cloudflare R2 などの S3 互換ストレージ
- CI / deploy / scheduled crawl: GitHub Actions

アプリ本体は Render 上の 1 サービスで `/`, `/guide`, `/events/:slug`, `/cal/*.ics`, `/admin/*`, `/healthz` を提供します。定期 crawl は常駐 worker ではなく GitHub Actions から `npm run crawl:due` を起動して本番 DB / S3 を更新します。

## 環境変数

ローカルでは `.env.example` の既定値で `SQLite + local storage` を使います。Render 本番では少なくとも次を設定してください。

- `BASE_URL`
- `ADMIN_USER`
- `ADMIN_PASSWORD`
- `REVIEWER_LABEL`
- `APP_DB_BACKEND=postgres`
- `DATABASE_URL`
- `APP_STORAGE_BACKEND=s3`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

## GitHub Actions

追加済み workflow:

- `.github/workflows/ci.yml`
  - `push` / `pull_request` で `npm ci`, `npm run build`, `npm test`
- `.github/workflows/deploy.yml`
  - `CI` 成功後の `main` で Render deploy hook を実行
  - `workflow_dispatch` で手動再デプロイも可能
- `.github/workflows/crawl.yml`
  - `03:00 JST` に `rule`
  - `06:00 / 12:00 / 18:00 / 23:00 JST` に `static_page` / `seeded_discovery`
  - `workflow_dispatch` では `due|rule|content|all` を選択可能

GitHub Secrets に設定するもの:

- `RENDER_DEPLOY_HOOK_URL`
- `DATABASE_URL`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `BASE_URL`
- `ADMIN_USER`
- `ADMIN_PASSWORD`
- `REVIEWER_LABEL`

値が揃ったら一括登録できます。

```bash
export RENDER_DEPLOY_HOOK_URL=...
export DATABASE_URL=...
export S3_ENDPOINT=...
export S3_REGION=auto
export S3_BUCKET=...
export S3_ACCESS_KEY_ID=...
export S3_SECRET_ACCESS_KEY=...
export BASE_URL=...
export ADMIN_USER=admin
export ADMIN_PASSWORD=...
export REVIEWER_LABEL=operator

./scripts/sync-github-secrets.sh
```

## Render

`render.yaml` を同梱しています。Blueprint から次を作成できます。

- `calendar-notifier` Web Service
- `calendar-notifier-db` Postgres

R2 の資格情報は Render 側で手動投入してください。

## 主なルート

- `/`
- `/guide`
- `/events/:slug`
- `/cal/all.ics`
- `/cal/lite.ics`
- `/cal/muji.ics`
- `/cal/amazon.ics`
- `/cal/rakuten.ics`
- `/healthz`
- `/admin/review`
- `/admin/review/:candidateId`
- `/admin/events`

`/admin/*` は Basic 認証です。

## 実装メモ

- DB adapter は `sqlite` / `postgres` の 2 実装です。
- object storage adapter は `local` / `s3` の 2 実装です。
- 公開 `.ics` は `PRODID`, `VERSION:2.0`, `REFRESH-INTERVAL;VALUE=DURATION`, `SEQUENCE`, `STATUS:CANCELLED`, `CRLF`, 75 オクテット折り返しに対応しています。
- 時刻付きイベントは UTC、終日イベントは date-only で配信します。
- `pending_review` は公開面から参照できません。
