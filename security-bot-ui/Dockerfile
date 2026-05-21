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

HEALTHCHECK --interval=20s --timeout=10s --start-period=30s --retries=5 \
  CMD node -e "require('http').get('http://localhost:'+process.env.PORT,r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/index.js"]
