FROM node:20-alpine

WORKDIR /app/server

COPY package*.json ./
RUN npm install

COPY src/ ./src/
RUN rm -f src/seed.ts

# 直接用 tsx 运行 TypeScript（无需编译）
EXPOSE 3001
CMD ["npx", "tsx", "src/index.ts"]
