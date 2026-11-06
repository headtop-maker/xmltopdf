# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    RESOURCE_DIR=/app/resources

# libxml2-utils provides xmllint for XSD validation; DejaVu supplies Cyrillic
# glyphs for the Chromium page footer (document text uses the bundled PT Sans).
RUN apt-get update \
 && apt-get install -y --no-install-recommends libxml2-utils fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules

# Chromium is installed at build time and pinned by the lockfile version.
# The container runs as a non-root user, so the Chromium sandbox stays enabled;
# --no-sandbox is deliberately not used.
RUN npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /tmp/*

# Poppler is used by the visual-regression tooling (PDF -> PNG) and by
# operational PDF inspection; it is not used by the conversion path itself.
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist
COPY resources ./resources

RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
