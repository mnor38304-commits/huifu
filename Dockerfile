FROM node:20-alpine AS builder

WORKDIR /app/server

COPY package*.json ./
RUN npm install --production

COPY src/ ./src/
RUN rm -f src/seed.ts
RUN npx tsc

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./

ENV PORT=3001
ENV DB_PATH=/app/data/vcc.db
ENV NODE_ENV=production

EXPOSE 3001
CMD ["node", "dist/index.js"]
