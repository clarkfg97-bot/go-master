FROM node:22-trixie-slim
# 围棋引擎：GNU Go（GPL），用 apt 安装，约 3MB
RUN apt-get update && apt-get install -y --no-install-recommends gnugo && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server.js package.json ./
COPY public ./public
ENV NODE_ENV=production GNUGO_BIN=/usr/games/gnugo
EXPOSE 10000
CMD ["node", "server.js"]
