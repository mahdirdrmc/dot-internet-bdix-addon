FROM node:20-alpine
WORKDIR /app
COPY package.json server.js ./
EXPOSE 7000
ENV PORT=7000
CMD ["node", "server.js"]
