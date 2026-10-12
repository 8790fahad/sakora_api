# sakora_api

Backend API for sakora Mobile — inventory, sales, purchases, expenses, and business management.

## Setup

```bash
npm install
cp .env.example .env   # configure database credentials
npm run dev
```

## Scripts

- `npm run dev` — start development server (port 5100)
- `npm start` — start production server
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
| `JWT_SECRET` | JWT signing secret |
| `PORT` | API port (default: 5100) |
| `FRONTEND_URL` | Shop/app URL for payment callbacks. Production: `https://sakora.shop` |
| `CORS_ORIGIN` | Allowed browser origins. Production should include `https://sakora.shop` and `https://www.sakora.shop` |

Production API: [https://nexifour.ng/sakora/api/health](https://nexifour.ng/sakora/api/health)

## Deploy

`.github/workflows/deploy.yml` runs on every push to `main`. It SSHs to the server, pulls, installs, and restarts the API.

The app lives at `/home/dev/aa_erp_api`. Add these repository secrets before the first run: `VPS_HOST`, `VPS_USER`, `VPS_PORT`, and `VPS_PASSWORD`.
