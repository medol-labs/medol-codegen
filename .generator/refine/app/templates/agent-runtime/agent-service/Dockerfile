FROM node:22-bookworm-slim
WORKDIR /app/agent-service
COPY agent-service/package.json agent-service/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY agent-service ./
COPY src/ai/capabilities.generated.json src/ai/assistants.custom.json /app/src/ai/
RUN mkdir -p /data && chown node:node /data
USER node
ENV AGENT_HOST=0.0.0.0
ENV AGENT_PORT=3100
ENV AGENT_DATA_DIR=/data
EXPOSE 3100
CMD ["node", "server.mjs"]
