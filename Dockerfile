FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "dist/server/index.js"]
