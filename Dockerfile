FROM oven/bun:1.3.9 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY shared ./shared
COPY public ./public
COPY index.html tsconfig.json ./
COPY scripts/version-assets.ts ./scripts/version-assets.ts
RUN bun run build

FROM oven/bun:1.3.9 AS runtime
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
ENV NODE_ENV=production PORT=3060 HOST=0.0.0.0
USER bun
EXPOSE 3060
CMD ["bun", "server/index.ts"]
