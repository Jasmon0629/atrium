# Atrium production image: one Node process serving API + Socket.IO + built frontend.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json server/package-lock.json* server/
RUN cd server && npm install --omit=dev --no-audit --no-fund

COPY server/src server/src
COPY web/dist web/dist

ENV PORT=4600
EXPOSE 4600
CMD ["node", "server/src/index.js"]
