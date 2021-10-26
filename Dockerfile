FROM node:lts-alpine

RUN apk add dumb-init

ENV NODE_ENV production
WORKDIR /app
COPY dist/meeting-service.js .

EXPOSE 18081
CMD [ "dumb-init", "node", "./meeting-service.js" ]