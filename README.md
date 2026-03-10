# MW-Cron

Administrative dashboard for monitoring endpoints with scheduled healthchecks, powered by cron jobs.

Notifies via **Discord Webhook** and **Telegram Bot** when services go down or recover.

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WASM-003B57?logo=sqlite&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-Framework-E36002)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)

## Features

- **Endpoint Monitoring** — Register URLs with configurable HTTP method, expected status code, timeout, and custom headers
- **Cron Scheduling** — Standard cron expressions for check intervals (`*/5 * * * *`, `0 * * * *`, etc.)
- **Notifications** — Discord webhooks and Telegram bot alerts on status changes (down + recovery)
- **Dashboard** — Real-time status cards with auto-refresh, stats overview, and recent activity
- **Check Logs** — Paginated history with filters by endpoint and status
- **Manual Checks** — Trigger healthchecks on demand from the UI
- **Session Auth** — HMAC-SHA256 signed cookies with 24h expiration
- **Dark/Blue Fantasy UI** — Custom theme with glow effects
- **Docker Ready** — Single command deploy with EasyPanel/Portainer support

## Quick Start

### Local

```bash
git clone https://github.com/wgmoretto/mw-cron.git
cd mw-cron
npm install
cp .env.example .env   # Edit credentials
npm run dev             # Development with hot reload
```

### Docker

```bash
docker compose up -d
```

Access at `http://localhost:8090`

## Configuration

All settings are via environment variables (`.env` file or Docker environment):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8090` | Server port |
| `DB_PATH` | `./data/mw-cron.db` | SQLite database path |
| `ADMIN_USER` | `admin` | Login username |
| `ADMIN_PASS` | `changeme` | Login password |
| `SESSION_SECRET` | — | **Required.** Random 32+ char string for session signing |

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20+ |
| Framework | [Hono](https://hono.dev) |
| Database | SQLite via [sql.js](https://sql.js.org) (WASM, zero native deps) |
| Scheduler | [cron](https://www.npmjs.com/package/cron) |
| Frontend | Vanilla HTML/CSS/JS (no build step) |
| Auth | HMAC-SHA256 signed session cookies |

## Project Structure

```
src/
├── index.js        # Entry point, server bootstrap, graceful shutdown
├── config.js       # Environment configuration
├── database.js     # SQLite init, migrations, auto-save
├── auth.js         # Session creation/validation, middleware
├── routes.js       # API endpoints + HTML page templates
├── checker.js      # HTTP healthcheck execution
├── scheduler.js    # Cron job management (register/reload/stop)
├── notifier.js     # Discord + Telegram notification dispatch
└── static/
    ├── css/style.css   # Dark/Blue Fantasy theme
    └── js/app.js       # Frontend logic (dashboard, CRUD, modals)
```

## API

All API routes require authentication (session cookie).

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/endpoints` | List all endpoints |
| `POST` | `/api/endpoints` | Create endpoint |
| `PUT` | `/api/endpoints/:id` | Update endpoint |
| `DELETE` | `/api/endpoints/:id` | Delete endpoint |
| `POST` | `/api/endpoints/:id/check` | Trigger manual check |
| `GET` | `/api/logs` | Get check logs (paginated, filterable) |
| `GET` | `/api/logs/stats` | Aggregate stats per endpoint |
| `GET` | `/api/dashboard/summary` | Dashboard data |
| `GET` | `/api/settings` | Get notification configs |
| `PUT` | `/api/settings/:channel` | Update notification config |
| `POST` | `/api/settings/:channel/test` | Send test notification |

## Notifications Setup

### Discord

1. In your Discord server, go to **Channel Settings > Integrations > Webhooks**
2. Create a webhook and copy the URL
3. In MW-Cron **Settings**, paste the webhook URL and enable

### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token
2. Get your chat ID (send a message to the bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)
3. In MW-Cron **Settings**, paste the bot token and chat ID, then enable

## Cron Expression Reference

| Expression | Schedule |
|-----------|----------|
| `*/1 * * * *` | Every minute |
| `*/5 * * * *` | Every 5 minutes |
| `*/30 * * * *` | Every 30 minutes |
| `0 * * * *` | Every hour |
| `0 */6 * * *` | Every 6 hours |
| `0 0 * * *` | Daily at midnight |

## License

MIT
