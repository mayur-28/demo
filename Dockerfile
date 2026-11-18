# Production image. Node 22.13+ is required for the built-in node:sqlite.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    DATABASE_FILE=/data/fuelform.db \
    TRUST_PROXY=1 \
    PORT=3001
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json tsconfig.json ./
COPY server ./server
COPY shared ./shared
EXPOSE 3001
# Mount a persistent volume at /data so accounts and logs survive restarts.
CMD ["node", "--import", "tsx", "server/index.ts"]
