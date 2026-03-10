FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY src/ ./src/

RUN mkdir -p /app/data

VOLUME ["/app/data"]

EXPOSE 80

CMD ["node", "src/index.js"]
