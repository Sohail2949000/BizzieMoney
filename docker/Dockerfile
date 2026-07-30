FROM --platform=$BUILDPLATFORM node:24-alpine AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.17.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .

RUN pnpm build

FROM build AS api-deployment

RUN pnpm --filter @bizziemoney/api deploy --prod --legacy /deploy/api

FROM build AS worker-deployment

RUN pnpm --filter @bizziemoney/worker deploy --prod --legacy /deploy/worker

FROM node:24-alpine AS service-runtime

RUN apk add --no-cache postgresql-client tini \
  && mkdir -p /app /data/attachments /data/backups \
  && chown -R node:node /app /data

ENV NODE_ENV=production

WORKDIR /app

USER node

ENTRYPOINT ["/sbin/tini", "--"]

FROM service-runtime AS api

COPY --chown=node:node --from=api-deployment /deploy/api ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]

FROM service-runtime AS worker

COPY --chown=node:node --from=worker-deployment /deploy/worker ./

CMD ["node", "dist/index.js"]

FROM nginxinc/nginx-unprivileged:1.29-alpine AS web

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
