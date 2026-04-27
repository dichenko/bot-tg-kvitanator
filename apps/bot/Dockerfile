FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/bot/package.json apps/bot/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --ignore-scripts --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm prisma:generate
RUN pnpm --filter @receipt-bot/shared build
RUN pnpm --filter @receipt-bot/db build
RUN pnpm --filter @receipt-bot/bot build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/bot/node_modules ./apps/bot/node_modules
COPY --from=build /app/apps/bot/dist ./apps/bot/dist
COPY --from=build /app/apps/bot/package.json ./apps/bot/package.json
COPY --from=build /app/packages/db ./packages/db
COPY --from=build /app/packages/shared ./packages/shared
COPY package.json pnpm-workspace.yaml ./
CMD ["node", "apps/bot/dist/index.js"]
