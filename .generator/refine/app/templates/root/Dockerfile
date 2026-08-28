FROM node:22-bookworm-slim AS deps

WORKDIR /app

COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./

RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then yarn global add pnpm && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

FROM node:22-bookworm-slim AS builder

WORKDIR /app
ENV NODE_ENV=production
ARG VITE_API_URL
ARG VITE_SUPABASE_API_KEY
ARG VITE_AUTH_PROVIDER
ARG VITE_AUTH_API_URL
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SUPABASE_API_KEY=${VITE_SUPABASE_API_KEY}
ENV VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER}
ENV VITE_AUTH_API_URL=${VITE_AUTH_API_URL}
<% backendModules.forEach((module) => { -%>
ARG <%= module.envName %>
ENV <%= module.envName %>=${<%= module.envName %>}
<% }) -%>

COPY --from=deps /app/node_modules ./node_modules

COPY . .

RUN npm run build

FROM nginx:1.27-alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/ /docker-entrypoint.d/
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
