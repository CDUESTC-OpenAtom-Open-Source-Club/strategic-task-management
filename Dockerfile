FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
COPY scripts/check-node-version.mjs scripts/check-node-version.mjs
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=/api/v1
ARG VITE_USE_MOCK=false
ARG VITE_ENABLE_DEVTOOLS=false
ARG VITE_LOG_LEVEL=warn
ARG VITE_APP_COMMIT_HASH=unknown
ARG VITE_APP_VERSION=dev
# 2026-10-20：生产密钥由构建期注入（CI Secrets / 本地构建），禁止写入仓库
ARG VITE_API_SECRET
ARG VITE_STORAGE_KEY

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_USE_MOCK=${VITE_USE_MOCK}
ENV VITE_ENABLE_DEVTOOLS=${VITE_ENABLE_DEVTOOLS}
ENV VITE_LOG_LEVEL=${VITE_LOG_LEVEL}
ENV VITE_APP_COMMIT_HASH=${VITE_APP_COMMIT_HASH}
ENV VITE_APP_VERSION=${VITE_APP_VERSION}
ENV VITE_API_SECRET=${VITE_API_SECRET}
ENV VITE_STORAGE_KEY=${VITE_STORAGE_KEY}

RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -q -O /dev/null http://localhost/ || exit 1
