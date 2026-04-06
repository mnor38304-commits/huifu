# ========== 阶段1：构建 admin 前端 ==========
FROM node:20-alpine AS admin-builder
WORKDIR /app/admin
COPY admin/package*.json ./
RUN npm install
COPY admin/ ./
RUN npm run build

# ========== 阶段2：构建 client 前端 ==========
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# ========== 阶段3：构建 server ==========
FROM node:20-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/src/ ./src/
COPY server/tsconfig.json ./
RUN npx tsc

# ========== 阶段4：运行阶段 ==========
FROM node:20-alpine

WORKDIR /app/server

# 拷贝 server 依赖和编译产物
COPY server/package*.json ./
RUN npm install --omit=dev
COPY --from=server-builder /app/server/dist ./dist

# 拷贝前端构建产物（server 会静态托管）
COPY --from=admin-builder /app/admin/dist ./public/admin
COPY --from=client-builder /app/client/dist ./public/client

# 暴露端口
EXPOSE 3001

# 启动应用
CMD ["node", "dist/index.js"]
