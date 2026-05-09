FROM node:20-alpine

WORKDIR /app

# native modüller için derleme araçları (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --omit=dev

COPY server/ ./server/

# Veri dizini (volume ile kalıcı hale getirilir)
RUN mkdir -p /app/data

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health

CMD ["node", "server/index.js"]
