# Implementation Checkpoints

## Checkpoint 1: Project Scaffold

- [x] Create monorepo structure.
- [x] Configure TypeScript.
- [x] Configure package manager workspaces.
- [x] Add bot app.
- [x] Add renderer-worker app.
- [x] Add shared/db package.
- [x] Add `.env.example`.
- [x] Add base README.

Acceptance criteria:

- [ ] `pnpm install` or `npm install` works.
- [ ] TypeScript builds without errors.

## Checkpoint 2: Docker Compose Infrastructure

- [x] Add PostgreSQL service.
- [x] Add bot service Dockerfile.
- [x] Add renderer-worker service Dockerfile.
- [x] Add persistent volumes for PostgreSQL, receipts, and exports.
- [x] Ensure services communicate by Docker service names.

Acceptance criteria:

- [ ] `docker compose up -d --build` starts all services.
- [ ] Bot container can connect to PostgreSQL.
- [ ] Bot container can call renderer-worker health endpoint.

## Checkpoint 3: Prisma Schema and Migrations

- [x] Create Prisma schema.
- [x] Add models: User, EntrepreneurProfile, Service, Operation, RenderJob.
- [x] Add enums: PaymentMethod, OperationStatus, RenderJobStatus.
- [x] Create first migration.
- [x] Add Prisma client wrapper.

Acceptance criteria:

- [ ] `prisma migrate dev` works locally.
- [ ] `prisma migrate deploy` works in Docker.
- [ ] Basic DB queries work from bot service.

## Checkpoint 4: Basic Telegram Bot

- [x] Add grammY.
- [x] Implement `/start`.
- [x] Implement `/help`.
- [x] Add main menu inline keyboard.
- [x] Add webhook mode.
- [x] Add optional polling mode for local development.
- [x] Add centralized error handler.

Acceptance criteria:

- [ ] Bot responds to `/start`.
- [ ] Bot displays main menu.
- [ ] Inline buttons trigger callbacks.

## Checkpoint 5: Registration Flow

- [x] Save/update Telegram user.
- [x] Check profile existence.
- [x] Ask for INN.
- [x] Ask for entrepreneur full name.
- [x] Ask for address.
- [x] Save EntrepreneurProfile.
- [x] Show main menu after registration.

Acceptance criteria:

- [ ] New user cannot create receipt before profile registration.
- [ ] Registered user goes directly to main menu.

## Checkpoint 6: Entrepreneur Profile Editing

- [x] Show current profile data.
- [x] Edit INN.
- [x] Edit full name.
- [x] Edit address.
- [x] Return to main menu.

Acceptance criteria:

- [ ] Changed profile data is used only for future operations.
- [ ] Existing operations keep old snapshot data.

## Checkpoint 7: Services Management

- [x] Show active services.
- [x] Add service.
- [x] Delete service via soft delete.
- [x] Confirm deletion.
- [x] Prevent empty or too long service titles.

Acceptance criteria:

- [ ] User sees only their own services.
- [ ] Deleted services disappear from active list.
- [ ] Existing operations remain valid after service deletion.

## Checkpoint 8: Receipt Draft Flow

- [x] Start new receipt flow.
- [x] Select service.
- [x] Enter amount manually.
- [x] Select payment method: cash or bank transfer.
- [x] Show pre-receipt preview.
- [x] Allow changing service, amount, payment method before confirmation.
- [x] Allow cancellation.

Acceptance criteria:

- [ ] User can create a complete draft via inline buttons and text input.
- [ ] Invalid amount is rejected.
- [ ] Preview displays all required data.

## Checkpoint 9: Operation Creation

- [x] Generate receipt number.
- [x] Create operation with snapshots.
- [x] Store status transitions.
- [x] Protect against duplicate final confirmation.

Acceptance criteria:

- [ ] Operation is stored in DB.
- [ ] Operation contains snapshots of profile and service data.
- [ ] Double-clicking generation does not create duplicate operations.

## Checkpoint 10: Renderer Worker

- [x] Create HTML receipt template.
- [x] Add `/health` endpoint.
- [x] Add `POST /render-receipt` endpoint.
- [x] Render HTML with operation data.
- [x] Generate JPEG with Playwright.
- [x] Save JPEG to persistent receipts directory.
- [x] Return image path to bot.

Acceptance criteria:

- [ ] Worker can generate a JPEG from test JSON.
- [ ] JPEG contains all required receipt fields.
- [ ] JPEG is readable on mobile.

## Checkpoint 11: Send Receipt to Telegram

- [x] Bot calls renderer-worker after confirmation.
- [x] Bot receives image path.
- [x] Bot sends JPEG to user.
- [x] Bot updates operation status to SENT.
- [x] On failure, bot sets operation status to FAILED and stores error.

Acceptance criteria:

- [ ] User receives a JPEG receipt after confirmation.
- [ ] Operation status is correct in DB.
- [ ] Failed render does not crash the bot.

## Checkpoint 12: Operations History

- [x] Show last 10 operations.
- [x] Show date, receipt number, service, amount, payment method, status.
- [x] Add button to resend generated receipt image.

Acceptance criteria:

- [ ] User sees only their own operations.
- [ ] User can resend an existing receipt image.

## Checkpoint 13: Excel Export

- [x] Add export menu.
- [x] Implement export for today.
- [x] Implement export for current month.
- [x] Implement export for previous month.
- [x] Implement export for all time.
- [x] Generate `.xlsx` with exceljs.
- [x] Add total amount row.
- [x] Send Excel file to Telegram.

Acceptance criteria:

- [ ] Excel file opens correctly.
- [ ] Columns are correct.
- [ ] Total amount is correct.
- [ ] Export includes only current user's operations.

## Checkpoint 14: Production Webhook and Caddy

- [x] Add webhook setup on startup.
- [x] Add Caddyfile example.
- [x] Document DNS/domain setup.
- [ ] Confirm public HTTPS webhook works.

Acceptance criteria:

- [ ] Telegram webhook is set successfully.
- [ ] Telegram updates reach the bot through HTTPS domain.

## Checkpoint 15: GitHub Actions Deploy

- [x] Add deploy workflow.
- [x] Configure SSH deployment.
- [x] Pull latest code on VPS.
- [x] Rebuild Docker Compose services.
- [x] Run migrations.
- [x] Restart bot and worker.

Acceptance criteria:

- [ ] Push to `main` deploys to VPS automatically.
- [ ] Existing PostgreSQL data persists across deploys.
- [ ] Bot remains available after deploy.

## Checkpoint 16: Final Hardening

- [x] Review all user-facing texts.
- [x] Ensure no fiscal/check terminology is used.
- [x] Add validation for all user inputs.
- [x] Add error logs.
- [x] Add README testing guide.
- [ ] Test full scenario from new user registration to Excel export.

Acceptance criteria:

- [ ] New user can complete registration.
- [ ] User can add service.
- [ ] User can create receipt.
- [ ] User receives JPEG.
- [ ] Operation is saved in DB.
- [ ] User can export Excel.
- [ ] User can edit profile data.
- [ ] User can delete service.
- [ ] User can view operation history.

## Final Deliverables

- [x] Full source code in a Git repository.
- [x] Docker Compose configuration.
- [x] Prisma schema and migrations.
- [x] Telegram bot implemented with grammY.
- [x] Renderer worker implemented with Playwright.
- [x] HTML receipt template.
- [x] Excel export implementation.
- [x] GitHub Actions deployment workflow.
- [x] `.env.example`.
- [x] `Caddyfile.example`.
- [x] README with local and production setup instructions.
- [x] CHECKPOINTS.md with implementation checklist.
