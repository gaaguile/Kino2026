FROM mcr.microsoft.com/playwright:v1.62.1-noble

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
COPY stats/estadisticas-kino.xlsx ./stats/estadisticas-kino.xlsx
COPY kino-history.json kino-history.xml ./

CMD ["npm", "run", "update-latest"]
