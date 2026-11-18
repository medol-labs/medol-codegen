# Build online once; the resulting executor never installs packages at startup.
ARG DOCKER_IMAGE=docker:28.1.1-cli
ARG NODE_IMAGE=node:22.16.0-alpine3.22
FROM ${DOCKER_IMAGE} AS dockercli
FROM ${NODE_IMAGE}
ARG TARGETARCH
ARG K3D_VERSION=v5.8.3
ARG KUBECTL_VERSION=v1.33.5
RUN apk add --no-cache bash ca-certificates curl openssh-client rsync tar git
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
RUN set -eu; case "$TARGETARCH" in amd64|arm64) ;; *) exit 1;; esac; \
    curl -fsSL --retry 3 "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-${TARGETARCH}" -o /usr/local/bin/k3d; \
    curl -fsSL --retry 3 "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" -o /tmp/kubectl; \
    curl -fsSL --retry 3 "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl.sha256" -o /tmp/kubectl.sha256; \
    cd /tmp; echo "$(cat kubectl.sha256)  kubectl" | sha256sum -c -; \
    mv kubectl /usr/local/bin/kubectl; rm kubectl.sha256; \
    chmod +x /usr/local/bin/k3d /usr/local/bin/kubectl; \
    node --version; docker --version; docker compose version; k3d version; kubectl version --client
COPY project/ /opt/simulation-project/
COPY manifest.json /opt/simulation-manifest.json
COPY entrypoint.mjs /opt/simulation-entrypoint.mjs
ENV HOME=/tmp/simulation-home
ENTRYPOINT ["node", "/opt/simulation-entrypoint.mjs"]
CMD ["info"]
