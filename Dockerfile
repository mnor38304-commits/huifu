# 使用 Node.js 20 基础镜像
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app/server

# 1. 先拷贝依赖定义文件
COPY server/package*.json ./

# 2. 安装所有依赖（包括 devDependencies 用于编译）
RUN npm install

# 3. 拷贝源码
COPY server/src/ ./src/
COPY server/tsconfig.json ./

# 4. 执行编译
RUN npx tsc

# --- 运行阶段 ---
FROM node:20-alpine

WORKDIR /app/server

# 拷贝 package.json
COPY server/package*.json ./

# 只安装生产环境依赖
RUN npm install --omit=dev

# 从构建阶段拷贝编译后的代码
COPY --from=builder /app/server/dist ./dist

# 暴露端口
EXPOSE 3001

# 启动应用
CMD ["node", "dist/index.js"]
