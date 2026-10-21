# sakora_api

Backend API for sakora Mobile — inventory, sales, purchases, expenses, and business management.

## Setup

```bash
npm install
cp .env.example .env   # configure database credentials
npm run dev
```

Optional Redis (recommended in production for shared rate limits and durable notification jobs):

```bash
# set REDIS_URL=redis://127.0.0.1:6379 in .env
npm run worker          # dedicated queue consumer (optional if embedded workers are on)
```

## Scripts

- `npm run dev` — start development server (port 5100)
- `npm start` — start production server
- `npm run worker` — process notification / email jobs (BullMQ when Redis is set)
- `npm run migrate` — run database migrations
- `npm run seed` — seed the database

## Environment

| Variable | Description |
|----------|-------------|
| `DB_HOST` | MySQL host |
| `DB_PORT` | MySQL port |
| `DB_NAME` | Database name |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |
| `JWT_SECRET` | JWT signing secret (required, 32+ chars in production) |
| `PORT` | API port (default: 5100) |
| `FRONTEND_URL` | Shop/app URL for payment callbacks. Production: `https://sakora.shop` |
| `DB_POOL_MAX` | MySQL connections per process. Default 8 in production |
| `WEB_CONCURRENCY` | API processes. Default `1` (quiet on small VPS). Raise only if you have spare CPU |
| `RATE_LIMIT_PER_MINUTE` | Requests allowed per IP each minute. Default 300 |
| `REDIS_URL` | Optional Redis for BullMQ + shared rate-limit store |
| `QUEUE_WORKER_EMBEDDED` | Set `false` when running a dedicated `npm run worker` |
| `STOREFRONT_URL` | Customer shop origin used for shop and payment links |
| `CORS_ORIGIN` | Extra allowed browser origins, comma-separated |

### Health endpoints

- `GET /api/health` — overall status (DB + queue backend)
- `GET /api/health/live` — process liveness
- `GET /api/health/ready` — DB (+ Redis when configured)

Production API: [https://nexifour.ng/sakora/api/health](https://nexifour.ng/sakora/api/health)

## Queue & scaling

Without Redis, outbound email/SMS/notifications run on an in-process concurrency-limited queue so HTTP handlers return immediately.

With `REDIS_URL` set:

1. Jobs are persisted in BullMQ
2. Rate limits are shared across cluster workers
3. Optionally run `pm2 start ecosystem.config.cjs --only sakora-worker` and set `QUEUE_WORKER_EMBEDDED=false` on the web app

Keep `DB_POOL_MAX × WEB_CONCURRENCY` under MySQL `max_connections`.

## Deploy

`.github/workflows/deploy.yml` runs on every push to `main`. It SSHs to the server, pulls, installs, and restarts the API.

The app lives at `/home/dev/sakora_api`. Add these repository secrets before the first run: `VPS_HOST`, `VPS_USER`, `VPS_PORT`, and `VPS_PASSWORD`.

```bash
pm2 start ecosystem.config.cjs --only sakora-api
# after Redis is available:
# pm2 start ecosystem.config.cjs --only sakora-worker
```
