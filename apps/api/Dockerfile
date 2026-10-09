FROM node:20-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter api prisma:generate && pnpm --filter api build
CMD ["sh", "-c", "pnpm --filter api prisma:deploy && pnpm --filter api seed && node apps/api/dist/src/server.js"]
