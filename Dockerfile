# syntax=docker/dockerfile:1.7

FROM node:24.16.0-bookworm-slim AS workspace

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable \
  && corepack prepare pnpm@11.5.2 --activate

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY --chown=node:node apps/api/package.json apps/api/package.json
COPY --chown=node:node apps/web/package.json apps/web/package.json
COPY --chown=node:node packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile

COPY --chown=node:node apps ./apps
COPY --chown=node:node packages ./packages
COPY --chown=node:node data ./data

FROM workspace AS web-build

RUN pnpm --filter @xuetu/web build

FROM workspace AS api

ENV PORT=3001

WORKDIR /app/apps/api

RUN mkdir -p /app/.runtime/external-questions \
  && chown -R node:node /app/.runtime

USER node

EXPOSE 3001

CMD ["./node_modules/.bin/tsx", "src/server.ts", "--lan"]

FROM caddy:2.10.2-alpine AS web

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv

EXPOSE 80
