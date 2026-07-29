# Makefile — single source of truth for build/test/smoke/release.
# All CI jobs delegate to these targets. No CI-specific logic here.
#
# Variables from .env (auto-included by make if present):
#   IMAGE_NAME, BUN_VERSION, MOCK_PORT, TEST_COLUMNS, TEST_RUNTIME
#
# Key outputs (git-ignored):
#   build/ocstatusline-linux-x64
#   build/ocstatusline-linux-arm64
#   build/ocstatusline-darwin-x64
#   build/ocstatusline-darwin-arm64

# Default target — build + test + smoke.
.PHONY: all
all: build test smoke

# Ensure .env exists (copy from .env.dist if missing), then include it.
-include .env
ifeq ($(wildcard .env),)
$(shell cp .env.dist .env)
-include .env
endif

# Image content tag — changes when BUN_VERSION or Dockerfile changes.
IMAGE_CONTENT_SHA := $(shell sha256sum .builder/Dockerfile .env | sha256sum | cut -d' ' -f1)
IMAGE_TAG := ${IMAGE_NAME}:${IMAGE_CONTENT_SHA}

# Resolve the actual image reference to pass to docker compose.
export COMPOSE_IMAGE = ${IMAGE_TAG}

# -----------------------------------------------------------------------------
# Image build
# -----------------------------------------------------------------------------
.PHONY: image
image:
	@echo "=== Building toolchain image ${IMAGE_TAG} ==="
	docker compose build builder
	docker tag ${IMAGE_NAME} ${IMAGE_TAG}
	@echo "=== Tagged ${IMAGE_TAG} ==="

# -----------------------------------------------------------------------------
# Build — platform binaries via bun build --compile
# -----------------------------------------------------------------------------
# bun build --compile only builds for the current platform.
# Cross-compilation requires --compile-executable-path with target-platform Bun binary,
# or running on the target platform. CI handles multi-platform via matrix.
#
# Default: build for linux-x64 (what the Docker builder runs on).
# Override with: make build TARGET=linux-arm64
TARGET ?= linux-x64

# Output path (under ./build/, git-ignored).
BINARY = build/ocstatusline-${TARGET}

.PHONY: build deps
build: deps ${BINARY} | image

# Install deps in the builder container (cached via node_modules volume).
.PHONY: deps
deps: | image
	@echo "=== Installing dependencies ==="
	docker compose run --rm -T \
		--entrypoint bun \
		builder \
		install

# Pattern rule: one docker compose run per target.
${BINARY}: deps | image
	@echo "=== Building for ${TARGET} ==="
	docker compose run --rm -T \
		-w /build \
		--entrypoint sh \
		builder \
		-c "bun build --compile /src/src/index.ts --outfile /build/ocstatusline-${TARGET} && cp /build/ocstatusline-${TARGET} /src/build/ocstatusline-${TARGET}"

# -----------------------------------------------------------------------------
# Test — vitest in toolchain image (bind-mounted source)
# -----------------------------------------------------------------------------
.PHONY: test
test: | image
	@echo "=== Running vitest (runtime: ${TEST_RUNTIME}) ==="
	docker compose run --rm -T \
		-e COLUMNS=${TEST_COLUMNS} \
		-e TEST_RUNTIME=${TEST_RUNTIME} \
		test-runner \
		vitest run

# -----------------------------------------------------------------------------
# Smoke — run compiled binary in Bun-less distroless image
# -----------------------------------------------------------------------------
.PHONY: smoke
smoke: ${BINARY}
	@echo "=== Smoke testing ${BINARY} ==="
	base=$$(basename ${BINARY}) ; \
	echo "--- $$base ---" ; \
	docker compose run --rm -T \
		-e COLUMNS=${TEST_COLUMNS} \
		smoke \
		/app/$$base start --server http://mock-opencode:4096 --timeout 5000

# -----------------------------------------------------------------------------
# Release — tag + push binaries to GitHub Release (manual target, run locally)
# -----------------------------------------------------------------------------
.PHONY: release
release: ${BINARY}
	@test -n "$(TAG)" || (echo "Usage: make release TAG=vX.Y.Z" && exit 1)
	@echo "=== Creating release $(TAG) ==="
	gh release create $(TAG) ${BINARY} --title "ocstatusline $(TAG)" --notes "Release $(TAG)"

# -----------------------------------------------------------------------------
# CI helper — run everything that CI runs (no release)
# -----------------------------------------------------------------------------
.PHONY: ci
ci: image build test smoke

# -----------------------------------------------------------------------------
# Clean
# -----------------------------------------------------------------------------
.PHONY: clean
clean:
	rm -rf build/
	docker rmi ${IMAGE_TAG} 2>/dev/null || true
	docker compose down -v --remove-orphans 2>/dev/null || true

# -----------------------------------------------------------------------------
# Utility: run mock-opencode standalone
# -----------------------------------------------------------------------------
.PHONY: mock
mock:
	docker compose up mock-opencode