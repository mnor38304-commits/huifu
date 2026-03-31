FROM node:20

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
RUN rm -f src/seed.ts
RUN npx tsc

EXPOSE 3001
CMD ["node", "dist/index.js"]
