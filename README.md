# sakora_api

Backend API for Inventria Mobile — inventory, sales, purchases, expenses, and business management.

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
