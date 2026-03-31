FROM node:20-alpine

WORKDIR /app

# 复制全部源码
COPY . .

# 安装 server 依赖并构建
WORKDIR /app/server
RUN npm install && npm run build

# 暴露端口
EXPOSE 3001

# 启动
CMD ["node", "dist/index.js"]
