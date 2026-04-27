FROM mcr.microsoft.com/playwright:v1.52.0-noble
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/renderer-worker/package.json apps/renderer-worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --ignore-scripts --frozen-lockfile=false

COPY . .
RUN pnpm --filter @receipt-bot/shared build
RUN pnpm --filter @receipt-bot/renderer-worker build

CMD ["node", "apps/renderer-worker/dist/index.js"]
