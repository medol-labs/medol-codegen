# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS node-base

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ARG PNPM_VERSION=10.25.0

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

FROM node-base AS deps

COPY package.json pnpm-lock.yaml .npmrc* ./

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --prefer-offline --store-dir /root/.local/share/pnpm/store

FROM node-base AS builder

ENV NODE_ENV=production
ENV NO_UPDATE_NOTIFIER=1
ENV UPDATE_NOTIFIER_IS_DISABLED=true
ARG VITE_API_URL
ARG VITE_SUPABASE_API_KEY
ARG VITE_AUTH_PROVIDER
ARG VITE_AUTH_API_URL
ARG VITE_FRONTEND_APP
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SUPABASE_API_KEY=${VITE_SUPABASE_API_KEY}
ENV VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER}
ENV VITE_AUTH_API_URL=${VITE_AUTH_API_URL}
ENV VITE_FRONTEND_APP=${VITE_FRONTEND_APP}
<% backendModules.forEach((module) => { -%>
ARG <%= module.envName %>
ENV <%= module.envName %>=${<%= module.envName %>}
<% }) -%>

COPY --from=deps /app/node_modules ./node_modules

COPY . .

RUN pnpm run build:bundle

FROM --platform=$TARGETPLATFORM nginx:1.27-alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/ /docker-entrypoint.d/
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
