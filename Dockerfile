# 先安装依赖
FROM node:20-alpine AS deps
WORKDIR /app
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm install

# 构建
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server/ ./server/
WORKDIR /app/server
RUN npm run build

# 运行
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/node_modules ./node_modules
COPY server/package*.json ./
EXPOSE 3001
CMD ["node", "dist/index.js"]
