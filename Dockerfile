FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

# Remove dev dependencies to slim the image
RUN npm prune --omit=dev

ENV MCP_TRANSPORT=http

CMD ["node", "dist/index.js"]
