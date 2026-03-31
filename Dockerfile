FROM node:20-alpine

WORKDIR /app

# 复制 package 文件
COPY package*.json ./
COPY server/package*.json ./server/
COPY server/tsconfig.json ./server/

# 安装依赖
WORKDIR /app/server
RUN npm install

# 复制源码并构建
COPY server/ ./server/
RUN npm run build

# 暴露端口
EXPOSE 3001

# 启动
CMD ["node", "dist/index.js"]
