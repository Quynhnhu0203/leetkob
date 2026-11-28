# Production API + Worker container (spawns isolated leetkob-sandbox sibling containers)
FROM node:22-alpine

# Install Docker CLI only so the backend worker can invoke hardened sandbox containers
RUN apk add --no-cache docker-cli

WORKDIR /app

COPY package*.json tsconfig.json tsconfig.build.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

EXPOSE 3000

CMD ["node", "dist/server.js"]

