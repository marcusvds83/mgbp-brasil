# Dockerfile para deploy no Render
# Usado se a abordagem npm install && npm run start falhar

FROM node:20-slim

# Install bun (caso precise de alguns pacotes)
RUN npm install -g bun

WORKDIR /app

# Copia package.json e lock
COPY package.json bun.lock* package-lock.json* ./

# Instala dependencias (com npm para garantir compatibilidade)
RUN npm install --legacy-peer-deps

# Copia codigo
COPY . .

# Build do Next.js standalone
RUN npm run build

# Expose port
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

# Comando para iniciar
CMD ["node", ".next/standalone/server.js"]
