#!/usr/bin/env bash
set -euo pipefail

BIN="${BIN:?BIN must point at the current-platform compiled binary}"
SERVER="${SERVER:?SERVER must point at the mock fixture server}"
TIMEOUT_SECONDS=5
TMP_FILES=()
TMP_ROOT="$(mktemp -d /tmp/ocsl-release-daemon.XXXXXX)"
TEST_HOME="$TMP_ROOT/home"
XDG_CONFIG_HOME="$TMP_ROOT/xdg-config"
active_pid=""
mkdir -p -- "$TEST_HOME" "$XDG_CONFIG_HOME/config"
export HOME="$TEST_HOME" XDG_CONFIG_HOME

wait_for_state() {
    local pattern="$1"
    local deadline=$((SECONDS + TIMEOUT_SECONDS))
    local state
    while (( SECONDS < deadline )); do
        state="$(curl -fsS "$SERVER/healthz" 2>/dev/null || true)"
        if [[ "$state" =~ $pattern ]]; then return 0; fi
        sleep 0.05
    done
    return 1
}

wait_for_exit() {
    local pid="$1"
    local deadline=$((SECONDS + TIMEOUT_SECONDS))
    local state
    while kill -0 "$pid" 2>/dev/null; do
        state="$(ps -o stat= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
        [[ "$state" == Z* ]] && return 0
        if (( SECONDS >= deadline )); then kill -KILL "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; return 1; fi
        sleep 0.05
    done
    return 0
}

stop_active_daemon() {
    local pid="${active_pid:-}"
    [[ -n "$pid" ]] || return 0
    active_pid=""
    kill -TERM "$pid" 2>/dev/null || true
    wait_for_exit "$pid" || true
    wait "$pid" 2>/dev/null || true
}

cleanup() {
    local file
    stop_active_daemon
    for file in "${TMP_FILES[@]}"; do
        rm -f -- "$file" || true
    done
    rm -rf -- "$TMP_ROOT" || true
}
trap cleanup EXIT

run_case() {
    local signal="$1"
    local out err pid rc
    out="$(mktemp /tmp/ocsl-release-daemon.XXXXXX.out)"
    err="$(mktemp /tmp/ocsl-release-daemon.XXXXXX.err)"
    TMP_FILES+=("$out" "$err")

    "$BIN" start --server "$SERVER" >"$out" 2>"$err" &
    pid=$!
    active_pid="$pid"
    wait_for_state '"activeConnections":[1-9][0-9]*' || fail_case "$signal" "$out" "$err"
    kill -s "$signal" "$pid" || fail_case "$signal" "$out" "$err"
    wait_for_exit "$pid" || fail_case "$signal" "$out" "$err"
    set +e
    wait "$pid"
    rc=$?
    set -e
    active_pid=""
    [[ "$rc" -eq 0 ]] || fail_case "$signal" "$out" "$err"
    wait_for_state '"activeConnections":0' || fail_case "$signal" "$out" "$err"
    echo "   $signal: exit=0, transport disconnected"
}

[[ -x "$BIN" ]] || { echo "FAIL: compiled binary is missing or not executable: $BIN" >&2; exit 1; }

echo ">> release daemon lifecycle: $BIN against $SERVER"

fail_case() {
    local signal="$1" out="$2" err="$3"
    echo "FAIL: $signal lifecycle assertion failed" >&2
    echo "--- stdout ---" >&2
    cat "$out" >&2
    echo "--- stderr ---" >&2
    cat "$err" >&2
    exit 1
}

run_case SIGTERM
run_case SIGINT
echo "OK: release-daemon-lifecycle passed"
