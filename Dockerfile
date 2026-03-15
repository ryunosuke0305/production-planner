FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

RUN mkdir -p /app/data

EXPOSE 8080

CMD ["sh", "-c", "npm run preview -- --host 0.0.0.0 --port ${PORT:-8080}"]
