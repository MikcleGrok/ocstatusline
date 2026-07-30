.DEFAULT_GOAL := help
.PHONY: help env image install lock typecheck test test-watch sh run config up down clean \
        build build-linux build-all manifest release smoke smoke-cli smoke-daemon smoke-tui \
        mock-up mock-down mock-logs mock-check record-fixture check-yoga check-musl probe-targets \
        ci-test ci-down ci-logs sync-upstream sync-verify \
        brew-info brew-audit

SHELL := /bin/bash

-include .env
IMAGE_NAME   ?= ocstatusline-toolchain
TEST_COLUMNS ?= 120
TEST_RUNTIME ?= bun
MOCK_PORT    ?= 4096

export

HOST_UID := $(shell id -u)
HOST_GID := $(shell id -g)

BASETAG := $(shell bash .builder/basetag.sh)
VERSION := $(shell git describe --tags --always --dirty)

CI_JOB_ID ?= local

ifeq ($(CI),true)
DC := docker compose -f docker-compose.yaml -f docker-compose.ci.override.yaml
else
DC := docker compose -p ocstatusline -f docker-compose.yaml -f docker-compose.override.yaml
endif

RELEASE_TARGETS ?= bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64

ifeq ($(shell uname -s),Darwin)
  ifeq ($(shell uname -m),arm64)
HOST_TARGET := bun-darwin-arm64
  else
HOST_TARGET := bun-darwin-x64
  endif
else
  ifeq ($(shell uname -m),aarch64)
HOST_TARGET := bun-linux-arm64
  else
HOST_TARGET := bun-linux-x64
  endif
endif

ifeq ($(shell docker version --format '{{.Server.Arch}}'),arm64)
LINUX_TARGET := bun-linux-arm64
else
LINUX_TARGET := bun-linux-x64
endif
LINUX_BIN := ocstatusline-$(patsubst bun-%,%,$(LINUX_TARGET))

# ==============================================================================
# Basics
# ==============================================================================

help: ## Show every documented target
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(firstword $(MAKEFILE_LIST)) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

env: ## Create .env from .env.dist (no-op when it already exists)
	@test -f .env || cp .env.dist .env

image: env ## Build the pinned Bun toolchain image when its content tag is missing
	bash .builder/build-image.sh

install: image ## Install dependencies from bun.lock into the cache volumes
	$(DC) run --rm --no-deps builder bun install --frozen-lockfile

lock: image ## Refresh bun.lock from package.json (use after touching dependencies)
	$(DC) run --rm --no-deps builder bun install

typecheck: image ## tsc --noEmit inside the toolchain image
	$(DC) run --rm --no-deps builder bunx tsc --noEmit

sh: image ## Interactive shell inside the toolchain image
	$(DC) run --rm --no-deps builder bash

run: image ## Run one command in the toolchain image: make run CMD="bun --version"
	$(DC) run --rm --no-deps builder bash -lc '$(CMD)'

config: env ## Show the resolved compose config: make config [ARGS=--services]
	$(DC) config $(ARGS)

up: image ## Start the long-running services (mock-opencode)
	$(DC) up -d --wait --wait-timeout 60 mock-opencode

down: env ## Stop the stack, keep the cache volumes
	$(DC) down --remove-orphans

clean: env ## Stop the stack, drop the cache volumes and the build output
	$(DC) down --volumes --remove-orphans
	rm -rf build

# ==============================================================================
# Tests
# ==============================================================================

ifeq ($(TEST_RUNTIME),node)
VITEST := node node_modules/vitest/vitest.mjs
else
VITEST := bunx vitest
endif

test: install ## Run the vitest suite inside the toolchain image
	$(DC) run --rm --no-deps test-runner $(VITEST) run --reporter=verbose

test-watch: install ## Run the vitest suite in watch mode inside the toolchain image
	$(DC) run --rm --no-deps test-runner $(VITEST)

# ==============================================================================
# Build (single self-contained binary per target)
# ==============================================================================

EXTRA_FLAGS ?= --minify

build: install ## Compile the binary for the developer's own platform into ./build
	@mkdir -p build
	$(DC) run --rm --no-deps -e VERSION="$(VERSION)" -e TARGETS="$(HOST_TARGET)" -e EXTRA_FLAGS="$(EXTRA_FLAGS)" builder bash /src/.builder/build-inside.sh

build-linux: install ## Compile the binary for the local Docker engine's platform (what smoke runs)
	@mkdir -p build
	$(DC) run --rm --no-deps -e VERSION="$(VERSION)" -e TARGETS="$(LINUX_TARGET)" -e EXTRA_FLAGS="$(EXTRA_FLAGS)" builder bash /src/.builder/build-inside.sh

build-all: install ## Cross-compile every release target into ./build
	@mkdir -p build
	$(DC) run --rm --no-deps -e VERSION="$(VERSION)" -e TARGETS="$(RELEASE_TARGETS)" -e EXTRA_FLAGS="$(EXTRA_FLAGS)" builder bash /src/.builder/build-inside.sh

# ==============================================================================
# Dependency guards (answers the spec's open questions mechanically)
# ==============================================================================

check-yoga: install ## Assert yoga-layout still loads its WASM statically (bun --compile requirement)
	$(DC) run --rm --no-deps builder bun run .builder/check-yoga-loader.ts

probe-targets: image ## Probe which bun --compile targets this pinned Bun actually accepts
	$(DC) run --rm --no-deps builder bash /src/.builder/probe-targets.sh

# ==============================================================================
# Artifacts
# ==============================================================================

manifest: ## Write build/SHA256SUMS over every artifact currently in ./build
	$(DC) run --rm --no-deps builder bash -lc 'cd /out && rm -f SHA256SUMS && sha256sum ocstatusline-* > SHA256SUMS && cat SHA256SUMS'

check-musl: build-linux ## Answer "are -musl targets needed": run the glibc binary on Alpine
	docker run --rm -v "$(CURDIR)/build:/out:ro" alpine:3.20 /out/$(LINUX_BIN) --version

# ==============================================================================
# Smoke (compiled binary in a Bun-less distroless image)
# ==============================================================================

smoke: build-linux mock-up ## Run all smoke tests
	$(MAKE) smoke-cli
	$(MAKE) smoke-daemon
	$(MAKE) smoke-tui

smoke-cli: build-linux ## Smoke: --version + no-TTY behaviour in the toolchain-less image
	$(DC) run --rm --no-deps -e BIN=/out/$(LINUX_BIN) -e EXPECTED_VERSION="$(VERSION)" -e COLUMNS=$(TEST_COLUMNS) -e TERM=xterm-256color smoke bash /smoke/smoke-cli.sh

smoke-daemon: build-linux mock-up ## Smoke: binary + mock-opencode -> real rendered status line
	$(DC) run --rm --no-deps -e BIN=/out/$(LINUX_BIN) -e SERVER=http://mock-opencode:4096 -e COLUMNS=$(TEST_COLUMNS) -e TERM=xterm-256color smoke bash /smoke/smoke-daemon.sh

smoke-tui: build-linux ## Smoke: config TUI of compiled binary under pty
	$(DC) run --rm --no-deps -e BIN=/out/$(LINUX_BIN) -e COLUMNS=$(TEST_COLUMNS) -e TERM=xterm-256color smoke bash /smoke/smoke-tui.sh

# ==============================================================================
# Mock server (fixture playback instead of a live `opencode serve`)
# ==============================================================================

mock-up: ## Start mock-opencode and wait until it is healthy
	$(DC) up -d --wait --wait-timeout 60 mock-opencode

mock-down: ## Stop mock-opencode
	$(DC) rm -sf mock-opencode

mock-logs: ## Follow mock-opencode's logs
	$(DC) logs -f --tail=100 mock-opencode

mock-check: mock-up ## Prove the SDK talks to mock-opencode: run the daemon in dev mode and grep its output
	$(DC) run --rm --no-deps -e OCSL_SERVER=http://mock-opencode:4096 --entrypoint bun builder run /src/.builder/mock-check.ts

record-fixture: install ## Re-record an event fixture from a live server: make record-fixture OUT=tests/fixtures/events/normal-session.jsonl SERVER=http://host.docker.internal:4096
	$(DC) run --rm --no-deps builder bun run scripts/record-fixtures.ts --out "$(OUT)" --server "$(SERVER)"

# ==============================================================================
# Release
# ==============================================================================

release: env ## Full release build: deps, gates, tests, smoke, every target, checksum manifest
	$(MAKE) install
	$(MAKE) typecheck
	$(MAKE) check-yoga
	$(MAKE) test
	$(MAKE) smoke
	$(MAKE) build-all
	$(MAKE) manifest
	@echo ">> release artifacts for $(VERSION):"
	@ls -l build/

# ==============================================================================
# CI helpers
# ==============================================================================

ci-test: image install typecheck test smoke ## What CI runs: make ci-test

ci-down: ## CI tear-down: stop stack, keep volumes for inspection
	$(DC) down --remove-orphans

ci-logs: ## Dump all service logs for CI debugging
	$(DC) logs --no-color

# ==============================================================================
# Upstream sync
# ==============================================================================

sync-upstream: ## Fetch upstream, fast-forward the `main` mirror, report what the work branch is missing
	git fetch upstream --tags
	git switch main
	git merge --ff-only upstream/main
	git switch bun-single-binary
	@echo ">> commits on main that bun-single-binary does not have yet:"
	@git log --oneline bun-single-binary..main || true
	@echo ">> next step is a rebase, and it is yours to run and confirm:"
	@echo "     git rebase main && make sync-verify"

sync-verify: ## Re-verify the fork after a rebase onto upstream: deps, guards, tests, smoke
	$(MAKE) lock
	$(MAKE) check-yoga
	$(MAKE) test
	$(MAKE) smoke
	@echo ">> sync verified for $(VERSION)"

# ==============================================================================
# Brew distribution
# ==============================================================================

brew-info: ## Print the end-user brew install commands (assumes the tap repo exists)
	@echo "Tap once:"
	@echo "  brew tap MikcleGrok/ocstatusline https://github.com/MikcleGrok/homebrew-ocstatusline"
	@echo "Then install (or upgrade):"
	@echo "  brew install ocstatusline"
	@echo "Or in one shot (Homebrew auto-creates the tap from homebrew-ocstatusline):"
	@echo "  brew install MikcleGrok/ocstatusline/ocstatusline"
	@echo ""
	@echo "See docs/homebrew-tap.md for the tap-repo layout and the per-release edit."

brew-audit: ## Run `brew audit --strict --new` against Formula/ocstatusline.rb (requires brew)
	brew audit --strict --new Formula/ocstatusline.rb