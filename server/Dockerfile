FROM node:24-alpine
WORKDIR /app
COPY publish-server.mjs .
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 8788
CMD ["node", "publish-server.mjs"]
