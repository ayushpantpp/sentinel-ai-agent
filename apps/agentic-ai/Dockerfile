FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm install
COPY . .
RUN npm run build
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/package.json
RUN npm install --omit=dev
COPY --from=build /app/server/dist server/dist
ENV PORT=3001
EXPOSE 3001
CMD ["npm", "run", "start", "-w", "server"]
