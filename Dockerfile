FROM node:24.21.0-alpine3.24

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY index.html player.html channel.html ./
COPY server ./server
COPY scripts/app.js scripts/catalog-data.js scripts/channel.js scripts/client-api.js scripts/player.js ./scripts/
COPY assets ./assets

ENV PORT=8085

CMD ["sh", "-c", "node server.js"]
