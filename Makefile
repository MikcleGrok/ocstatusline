.DEFAULT_GOAL := help
.PHONY: help env image install lock typecheck test test-unit test-functional test-acceptance test-all test-watch acceptance-tui sh run config up down clean \
        generate-tui-plugin-assets \
        build build-linux build-all manifest release release-check smoke smoke-cli smoke-daemon smoke-tui smoke-install \
        mock-up mock-down mock-logs mock-check record-fixture check-yoga check-musl probe-targets \
        ci-test ci-down ci-logs sync-upstream sync-verify \
        brew-info brew-audit check-homebrew-formula

SHELL := /bin/bash

-include .env
IMAGE_NAME   ?= ocstatusline-toolchain
TEST_COLUMNS ?= 120
TEST_RUNTIME ?= bun
ACCEPTANCE_TUI_TIMEOUT ?= 90s
ACCEPTANCE_TUI_KILL_AFTER ?= 5s
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

DOCKER_PLATFORM := $(strip $(DOCKER_DEFAULT_PLATFORM))
ifeq ($(strip $(DOCKER_PLATFORM)),)
DOCKER_PLATFORM := linux/$(shell docker version --format '{{.Server.Arch}}')
endif

ifeq ($(DOCKER_PLATFORM),linux/arm64)
LINUX_TARGET := bun-linux-arm64
else ifeq ($(DOCKER_PLATFORM),linux/amd64)
LINUX_TARGET := bun-linux-x64
else
$(error Unsupported Docker platform '$(DOCKER_PLATFORM)'; expected linux/amd64 or linux/arm64)
endif
export DOCKER_DEFAULT_PLATFORM := $(DOCKER_PLATFORM)
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
	$(DC) run --rm --no-deps --user 0:0 builder npm install --prefix .opencode --no-audit --no-fund

lock: image ## Refresh bun.lock from package.json (use after touching dependencies)
	$(DC) run --rm --no-deps builder bun install

generate-tui-plugin-assets: install ## Re-bake the TUI plugin source into src/tui/embedded-plugin-assets.generated.ts (run after touching the plugin or its closure)
	$(DC) run --rm --no-deps builder bun run scripts/generate-tui-plugin-assets.ts

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

test: test-unit ## Run the fast unit suite inside the toolchain image

test-unit: install ## Run unit, render and data tests without process/acceptance boundaries
	$(DC) run --rm --no-deps test-runner $(VITEST) run --reporter=verbose --exclude='tests/acceptance/**' --exclude='tests/mock/**' --exclude='tests/tui/openrouter.test.ts'

test-functional: install ## Run Bun process and transport functional tests
	$(DC) run --rm --no-deps test-runner bun run tests/acceptance/cli.acceptance.ts
	$(DC) run --rm --no-deps test-runner $(VITEST) run --reporter=verbose tests/mock tests/tui/openrouter.test.ts tests/render/stdin.test.ts

test-acceptance: acceptance-tui smoke ## Run native TUI and compiled artifact acceptance

test-all: test-unit test-functional test-acceptance ## Run every required local test level

test-watch: install ## Run the vitest suite in watch mode inside the toolchain image
	$(DC) run --rm --no-deps test-runner $(VITEST)

acceptance-tui: install ## Run the production OpenTUI plugin through the native test renderer
	$(DC) run --rm --no-deps --workdir /src/.opencode test-runner timeout --foreground --kill-after=$(ACCEPTANCE_TUI_KILL_AFTER) $(ACCEPTANCE_TUI_TIMEOUT) bun run ../tests/tui/opentui.acceptance.ts || { status=$$?; if [ $$status -eq 124 ]; then echo "ERROR: OpenTUI acceptance exceeded $(ACCEPTANCE_TUI_TIMEOUT) wall-clock deadline and was terminated" >&2; fi; exit $$status; }

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

check-homebrew-formula: ## Verify formula version and every prebuilt asset checksum
	bash scripts/verify-distribution.sh --tag "$(TAG)"

check-musl: build-linux ## Answer "are -musl targets needed": run the glibc binary on Alpine
	docker run --rm -v "$(CURDIR)/build:/out:ro" alpine:3.20 /out/$(LINUX_BIN) --version

# ==============================================================================
# Smoke (compiled binary in a Bun-less distroless image)
# ==============================================================================

smoke: build-linux mock-up ## Run all smoke tests
	$(MAKE) smoke-cli
	$(MAKE) smoke-daemon
	$(MAKE) smoke-tui
	$(MAKE) smoke-install

smoke-cli: build-linux ## Smoke: --version + no-TTY behaviour in the toolchain-less image
	$(DC) run --rm --no-deps -e BIN=/out/$(LINUX_BIN) -e EXPECTED_VERSION="$(VERSION)" -e COLUMNS=$(TEST_COLUMNS) -e TERM=xterm-256color smoke bash /smoke/smoke-cli.sh

smoke-daemon: build-linux mock-up ## Smoke: binary + mock-opencode -> real rendered status line
	$(DC) run --rm --no-deps -e BIN=/out/$(LINUX_BIN) -e SERVER=http://mock-opencode:4096 -e COLUMNS=$(TEST_COLUMNS) -e TERM=xterm-256color smoke bash /smoke/smoke-daemon.sh

smoke-tui: build-linux ## Smoke: config TUI of compiled binary under pty
	$(DC) run --rm --no-deps -e BIN=/out/$(LINUX_BIN) -e COLUMNS=$(TEST_COLUMNS) -e TERM=xterm-256color smoke bash /smoke/smoke-tui.sh

smoke-install: build-linux ## Smoke: `install` from the binary alone writes the embedded plugin into a fake HOME
	$(DC) run --rm --no-deps -e BIN=/out/$(LINUX_BIN) smoke bash /smoke/smoke-install.sh

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
	$(MAKE) acceptance-tui
	$(MAKE) check-yoga
	$(MAKE) test-unit
	$(MAKE) test-functional
	$(MAKE) smoke
	$(MAKE) build-all
	$(MAKE) manifest
	@echo ">> release artifacts for $(VERSION):"
	@ls -l build/

release-check: ## Validate a planned release without creating a tag or publishing
	@test -n "$(TAG)" || { echo "ERROR: TAG is required, for example TAG=v0.2.5" >&2; exit 2; }
	@test "$(TAG)" != "$$(git describe --exact-match --tags HEAD 2>/dev/null || true)" || { echo "ERROR: TAG already points at HEAD; pre-tag check requires a planned, uncreated tag" >&2; exit 1; }
	@test -z "$$(git status --porcelain)" || { echo "ERROR: release-check requires a clean worktree" >&2; git status --short >&2; exit 1; }
	case "$(TAG)" in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "ERROR: TAG must match vMAJOR.MINOR.PATCH" >&2; exit 1;; esac
	@test -f build/SHA256SUMS || { echo "ERROR: build/SHA256SUMS is missing; run make manifest" >&2; exit 1; }
	for asset in ocstatusline-darwin-arm64 ocstatusline-darwin-x64 ocstatusline-linux-arm64 ocstatusline-linux-x64; do test -x "build/$$asset" || { echo "ERROR: missing or non-executable build/$$asset" >&2; exit 1; }; done
	( cd build && sha256sum -c SHA256SUMS )
	@echo ">> release-check passed for $(TAG)"

# ==============================================================================
# CI helpers
# ==============================================================================

ci-test: image install typecheck test-unit test-functional acceptance-tui smoke ## What CI runs: all mandatory gates in order

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
