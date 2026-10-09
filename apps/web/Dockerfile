FROM node:20-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter web build
CMD ["pnpm", "--filter", "web", "start"]
