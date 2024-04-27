FROM node:20-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=dev /app/dist ./dist
COPY src/views ./src/views
COPY public ./public
USER node
EXPOSE 3000
CMD ["sh", "-c", "node node_modules/knex/bin/cli.js --knexfile dist/knexfile.js migrate:latest && exec node dist/src/index.js"]
