FROM node:20

WORKDIR /app/server

# 先复制 package.json 和 tsconfig
COPY package*.json tsconfig.json ./

# 安装依赖
RUN npm install

# 复制源码
COPY src/ ./src/

# 构建
RUN npx tsc

# 暴露端口
EXPOSE 3001

# 启动
CMD ["node", "dist/index.js"]
