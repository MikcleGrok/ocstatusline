# Toolchain image: Bun toolchain + deps cached, no source code baked in.
# Build once, run many containers. Source is bind-mounted at runtime.
#
# ARG/ENV BUN_VERSION is the single source of truth. Changing it changes the
# content tag (sha256), so `make image` rebuilds automatically.
ARG BUN_VERSION
FROM oven/bun:${BUN_VERSION}-debian AS toolchain

# Install git (needed for git widgets at runtime inside smoke image) and
# any native build deps Bun might need.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
    && rm -rf /var/lib/apt/lists/*

# Workdir where source will be bind-mounted at runtime.
WORKDIR /src

# No source COPY here — bind-mounted by docker-compose.yml.

# Entrypoint is just bun; services in docker-compose.yml override CMD.
ENTRYPOINT ["bun"]