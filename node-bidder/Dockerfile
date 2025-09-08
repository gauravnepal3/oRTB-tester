# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm i --omit=dev
COPY bidder.js ./
EXPOSE 9100
CMD ["node", "bidder.js"]