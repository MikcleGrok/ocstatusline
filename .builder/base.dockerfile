# The one toolchain image for ocstatusline-bun.
#
# Bun is pinned by BUN_VERSION (see .env.dist) and is the only runtime that ever
# builds or runs the shipped binary. Two extras ride along, and neither touches
# the artifact:
#   * Node 22 — fallback runtime for the vitest suite (TEST_RUNTIME=node), so the
#     runner question can be answered without rebuilding the image.
#   * bsdextrautils — provides script(1), which the pty smoke test needs to give
#     the compiled config TUI a real terminal.
ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}-debian

ARG NODE_MAJOR=22

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bsdextrautils \
      ca-certificates \
      curl \
      git \
      gnupg \
      unzip \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
       | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

ENV HOME=/tmp \
    BUN_INSTALL_CACHE_DIR=/bun-cache \
    npm_config_update_notifier=false
RUN mkdir -p /src/node_modules /bun-cache /out \
 && chmod 0777 /src /src/node_modules /bun-cache /out

WORKDIR /src
ENTRYPOINT []
CMD ["bash"]