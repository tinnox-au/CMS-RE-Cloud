# syntax=docker/dockerfile:1
# Media validation worker (prototype-m0.md D11). Build context: the repository root.
#   docker compose --env-file .env -f infra/docker-compose.yml --profile worker up -d --build media-worker
#
# The image contains only the worker source, the shared contract schemas, its three
# runtime dependencies and ffmpeg (for ffprobe). It contains no application secret and
# is run with no network, a read-only root filesystem and all capabilities dropped.
# Base: Node.js 24 (LTS) on Alpine 3.24, pinned by tag and digest.

FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS deps
WORKDIR /app
# Only manifests: the lockfile decides every version. Install scripts are not run.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/media-worker/package.json apps/media-worker/
COPY apps/portal/package.json apps/portal/
COPY apps/player-web/package.json apps/player-web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/delivery/package.json packages/delivery/
COPY packages/domain/package.json packages/domain/
COPY packages/storage/package.json packages/storage/
COPY tests/package.json tests/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
      --workspace @tinnox/media-worker --workspace @tinnox/contracts --include-workspace-root=false \
 && rm -rf /root/.npm

FROM node:24.22.3-alpine3.24@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS runtime
# ffprobe ships in Alpine's ffmpeg package. Pinned to the exact build: ffprobe parses
# untrusted uploads, so a rebuild must not silently pick up another parser version.
# Alpine drops superseded package builds from its mirrors, so this line fails to build
# once 8.1.3-r0 is replaced: update it deliberately (security fixes) and re-run the
# worker integration tests.
RUN apk add --no-cache 'ffmpeg=8.1.3-r0' \
 && addgroup -S -g 10001 worker \
 && adduser -S -D -H -u 10001 -G worker -s /sbin/nologin worker \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/contracts ./packages/contracts
COPY apps/media-worker/package.json ./apps/media-worker/package.json
COPY apps/media-worker/src ./apps/media-worker/src
# The worker imports @tinnox/contracts as TypeScript source. Node strips types natively
# for files outside node_modules, so the package is linked exactly as npm workspaces link it.
RUN mkdir -p node_modules/@tinnox \
 && rm -rf node_modules/@tinnox/contracts \
 && ln -s ../../packages/contracts node_modules/@tinnox/contracts
ENV NODE_ENV=production \
    MEDIA_JOBS_DIR=/jobs \
    HOME=/tmp \
    NODE_OPTIONS=--max-old-space-size=256
USER 10001:10001
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "apps/media-worker/src/main.ts"]
