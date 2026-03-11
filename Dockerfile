FROM node:20-alpine

RUN apk add --no-cache curl

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY src/ ./src/

RUN mkdir -p /app/data

VOLUME ["/app/data"]

EXPOSE 80

CMD ["node", "src/index.js"]
