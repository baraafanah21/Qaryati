# syntax=docker/dockerfile:1

# API image, also used by the one-shot `migrate` service in docker-compose.yml.

# --- build: compile TypeScript with dev dependencies ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# --ignore-scripts: `prepare` installs Git hooks, which a container does not need.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# --- runtime: production dependencies, compiled code and migrations only ---
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# Verify the packaged native binary works even when install scripts are disabled.
RUN node -e "const a=require('argon2'); a.hash('build-smoke',{type:a.argon2id,memoryCost:19456,timeCost:2,parallelism:1}).then(async h=>{if(!await a.verify(h,'build-smoke'))process.exit(1)})"
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# The image's unprivileged user; the process cannot modify its own code.
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
