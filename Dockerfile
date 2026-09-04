# --- Etapa 1: dependencias (incluye compilacion nativa de better-sqlite3) ---
FROM node:20-alpine AS deps

WORKDIR /app

# Herramientas de compilacion necesarias para node-gyp/better-sqlite3 en musl
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# --- Etapa 2: imagen final, sin herramientas de compilacion ---
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S bot && adduser -S bot -G bot

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

RUN mkdir -p /app/data && chown -R bot:bot /app

VOLUME ["/app/data"]
USER bot

CMD ["node", "src/index.js"]
