services:
  axon-server:
    image: axoniq/axonserver:latest-jdk-17
    hostname: axon-server
    profiles:
      - axon-server
    ports:
      - "${AXON_SERVER_HTTP_PORT:-8024}:8024"
      - "${AXON_SERVER_GRPC_PORT:-8124}:8124"
    environment:
      axoniq_axonserver_hostname: axon-server
      axoniq_axonserver_autocluster_dcb: "true"
      axoniq_axonserver_autocluster_contexts: _admin,default
    volumes:
      - axon_server_data:/axonserver/data
      - axon_server_events:/axonserver/events
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8024/actuator/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

<% deployments.forEach((deployment) => { -%>
  <%= deployment.serviceName %>-postgres:
    image: postgres:16
    ports:
      - "${<%= deployment.envPrefix %>_DB_PORT:-<%= deployment.dbPort %>}:5432"
    environment:
      POSTGRES_USER: medol
      POSTGRES_PASSWORD: medol
      POSTGRES_DB: <%= deployment.dbName %>
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U medol -d <%= deployment.dbName %>"]
      interval: 5s
      timeout: 5s
      retries: 10
    volumes:
      - <%= deployment.serviceName %>_postgres_data:/var/lib/postgresql/data

<% }) -%>
volumes:
  axon_server_data:
  axon_server_events:
<% deployments.forEach((deployment) => { -%>
  <%= deployment.serviceName %>_postgres_data:
<% }) -%>
