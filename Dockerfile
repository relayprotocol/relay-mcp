FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV MCP_TRANSPORT=http

CMD ["node", "dist/index.js"]
