# Dockerfile (optional)
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm ci --omit=dev
COPY bidder.js ./
ENV PORTS=9100,9101,9102,9103,9104 \
    MIN_DELAY_MS=15 \
    HEADROOM_MS=5 \
    LATE_FRACTION=0.10 \
    BLOB_BYTES=256 \
    GZIP=0
EXPOSE 9100 9101 9102 9103 9104
CMD ["node", "bidder.js"]