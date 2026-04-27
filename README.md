# Telegram Receipt Bot

MVP Telegram bot for individual entrepreneurs that registers incoming payments, generates internal receipt images, stores operations in PostgreSQL, and exports operations to Excel.

This project does not generate fiscal receipts and does not integrate with online cash registers or OFD services. The generated document is an internal receipt (`Квитанция`).

## Status

Implementation progress is tracked in [CHECKPOINTS.md](CHECKPOINTS.md).

## Stack

- Node.js 20+
- TypeScript
- grammY
- PostgreSQL 16
- Prisma
- Playwright
- Handlebars
- ExcelJS
- Docker Compose
- Caddy

## Local setup

1. Install `pnpm` and Docker.
2. Copy `.env.example` to `.env` and fill in real values.
3. Install dependencies:

```bash
pnpm install
```

4. Generate Prisma client and run migrations:

```bash
pnpm prisma:generate
pnpm prisma:migrate:dev
```

5. Start the stack:

```bash
docker compose up -d --build
```

6. For local bot polling, set `BOT_MODE=polling`.

## Docker Compose

The main stack includes:

- `postgres`
- `bot`
- `renderer-worker`

Generated files are stored in Docker volumes:

- `postgres_data`
- `receipts_storage`
- `exports_storage`

Database connection string does not need to be stored manually in `.env`.
It is assembled automatically from:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_PORT`

Optional override:

- `POSTGRES_HOST` defaults to `postgres` for the internal Docker network.

## Prisma

Useful commands:

```bash
pnpm prisma:generate
pnpm prisma:migrate:dev
pnpm prisma:migrate:deploy
```

## Production deployment

1. Provision a VPS with Docker and Docker Compose.
2. Keep the real `.env` file on the server only.
3. Configure Caddy with your domain.
4. Point the domain A or AAAA record to the VPS public IP.
4. Push to `main` to trigger GitHub Actions deployment.

The workflow will:

1. Pull latest code on the VPS.
2. Rebuild containers.
3. Restart services.
4. Run Prisma migrations inside the bot container.

## DBeaver via SSH tunnel

Example:

```text
Host: VPS IP
SSH user: root or deploy user
Database host from server side: 127.0.0.1
Database port: 5432
```

If you need host-level access for local-only tooling, bind PostgreSQL only to loopback:

```yaml
ports:
  - "127.0.0.1:5432:5432"
```

Do not bind PostgreSQL to `0.0.0.0`.

## Webhook notes

- Production mode uses `BOT_MODE=webhook`.
- The bot exposes `WEBHOOK_PATH` on `BOT_PORT`.
- `WEBHOOK_URL` must point to the public HTTPS domain proxied by Caddy.
- The DNS record for the domain must resolve to the VPS before calling `setWebhook`.
- `RENDERER_URL` intentionally uses `http://renderer-worker:3001` because it is an internal Docker-network call, not a public endpoint.

## Main test flows

1. Start the bot with `/start`.
2. Complete entrepreneur profile registration.
3. Add a service.
4. Create a receipt and confirm generation.
5. Receive a JPEG receipt in Telegram.
6. Open operations history and resend the receipt.
7. Export operations to Excel for different periods.

## Receipt numbering

MVP uses an operation-id-based receipt number in the format `KV-000001`. This avoids duplicate numbers per user without introducing a separate sequence table.
