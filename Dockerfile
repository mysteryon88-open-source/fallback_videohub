FROM node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY index.html player.html channel.html ./
COPY server ./server
COPY scripts/app.js scripts/catalog-data.js scripts/channel.js scripts/client-api.js scripts/player.js ./scripts/
COPY assets ./assets

ENV PORT=8085

CMD ["sh", "-c", "node server.js"]
