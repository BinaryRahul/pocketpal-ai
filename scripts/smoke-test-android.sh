#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: smoke-test-android.sh <apk> [output-dir] [package-id] [activity]

Installs the exact APK, performs two cold starts, waits for delayed React Native
startup failures, and preserves logcat/dumpsys diagnostics on every failure.
EOF
  exit 2
}

[[ $# -ge 1 && $# -le 5 ]] || usage
INSTALLED=0
if [[ "$1" == "--installed" ]]; then
  INSTALLED=1
  APK=""
  OUT_DIR=${2:-smoke-output}
  PACKAGE_ID=${3:-com.pocketpallite}
  ACTIVITY=${4:-com.pocketpal.MainActivity}
else
  APK=$1
  OUT_DIR=${2:-smoke-output}
  PACKAGE_ID=${3:-com.pocketpallite}
  ACTIVITY=${4:-com.pocketpal.MainActivity}
fi
if [[ -n "${ADB_SERIAL:-}" ]]; then
  ADB=(adb -s "$ADB_SERIAL")
else
  ADB=("${ADB:-adb}")
fi
WAIT_SECONDS=${WAIT_SECONDS:-12}

if ((INSTALLED == 0)); then
  [[ -f "$APK" ]] || { echo "APK not found: $APK" >&2; exit 1; }
fi
command -v "${ADB[0]}" >/dev/null || { echo "adb not found: ${ADB[0]}" >&2; exit 1; }
mkdir -p "$OUT_DIR"

FAILED=0
CURRENT_ATTEMPT="setup"

collect_diagnostics() {
  local prefix=$1
  "${ADB[@]}" logcat -v threadtime -b main -b system -b crash -d > "$OUT_DIR/${prefix}-logcat.txt" 2>&1 || true
  "${ADB[@]}" shell dumpsys activity activities > "$OUT_DIR/${prefix}-dumpsys-activity.txt" 2>&1 || true
  "${ADB[@]}" shell dumpsys package "$PACKAGE_ID" > "$OUT_DIR/${prefix}-dumpsys-package.txt" 2>&1 || true
  "${ADB[@]}" shell pidof "$PACKAGE_ID" > "$OUT_DIR/${prefix}-pid.txt" 2>&1 || true
  "${ADB[@]}" shell dumpsys meminfo "$PACKAGE_ID" > "$OUT_DIR/${prefix}-process-state.txt" 2>&1 || true
}

fail() {
  echo "FAIL: $*" >&2
  FAILED=1
  return 1
}

on_exit() {
  local status=$?
  if ((status != 0 || FAILED != 0)); then
    collect_diagnostics "failure-${CURRENT_ATTEMPT}"
    echo "Smoke-test diagnostics written to $OUT_DIR" >&2
  fi
  exit "$status"
}
trap on_exit EXIT

# Install the exact artifact under test unless bundletool has already
# installed the generated APK set on this device. Clearing app data makes the
# first launch deterministic and avoids a previous run masking a regression.
if ((INSTALLED == 0)); then
  CURRENT_ATTEMPT="install"
  "${ADB[@]}" install -r "$APK" > "$OUT_DIR/install.txt" 2>&1 || { cat "$OUT_DIR/install.txt" >&2; fail "adb install failed"; }
fi
"${ADB[@]}" shell pm clear "$PACKAGE_ID" > "$OUT_DIR/pm-clear.txt" 2>&1 || true

run_attempt() {
  local attempt=$1
  local start_file="$OUT_DIR/attempt-${attempt}-start.txt"
  local log_file="$OUT_DIR/attempt-${attempt}-logcat.txt"
  local app_log="$OUT_DIR/attempt-${attempt}-app-logcat.txt"
  local pid=""
  CURRENT_ATTEMPT="attempt-${attempt}"

  "${ADB[@]}" shell am force-stop "$PACKAGE_ID" >/dev/null 2>&1 || true
  "${ADB[@]}" logcat -c
  "${ADB[@]}" shell am start -W -n "$PACKAGE_ID/$ACTIVITY" > "$start_file" 2>&1 || {
    cat "$start_file" >&2
    fail "activity start command failed on attempt $attempt"
  }
  grep -q 'Status: ok' "$start_file" || {
    cat "$start_file" >&2
    fail "activity did not report Status: ok on attempt $attempt"
  }

  sleep "$WAIT_SECONDS"
  "${ADB[@]}" logcat -v threadtime -b main -b system -b crash -d > "$log_file" 2>&1 || true
  "${ADB[@]}" shell dumpsys activity activities > "$OUT_DIR/attempt-${attempt}-dumpsys-activity.txt" 2>&1 || true
  "${ADB[@]}" shell dumpsys package "$PACKAGE_ID" > "$OUT_DIR/attempt-${attempt}-dumpsys-package.txt" 2>&1 || true
  "${ADB[@]}" shell pidof "$PACKAGE_ID" > "$OUT_DIR/attempt-${attempt}-pid.txt" 2>&1 || true
  "${ADB[@]}" shell dumpsys meminfo "$PACKAGE_ID" > "$OUT_DIR/attempt-${attempt}-process-state.txt" 2>&1 || true

  pid=$(tr -d '\r\n' < "$OUT_DIR/attempt-${attempt}-pid.txt" || true)
  if [[ -z "$pid" ]]; then
    # A process that died may still be identifiable from ActivityManager's
    # Start proc line, which lets us isolate its Java/native log lines.
    pid=$(grep -Eo "Start proc [0-9]+:${PACKAGE_ID}" "$log_file" | tail -1 | awk '{print $3}' | cut -d: -f1 || true)
  fi

  if [[ -n "$pid" ]]; then
    awk -v p="$pid" '$0 ~ " " p " " {print}' "$log_file" > "$app_log" || true
  else
    grep -E "$PACKAGE_ID|ReactNativeJS|SoLoader|Hermes|CxxInspectorPackagerConnection|InspectorFlags" "$log_file" > "$app_log" || true
  fi

  # Include only app/package-specific lines plus the system_server activity
  # termination line. Do not scan the whole emulator log: Android Settings and
  # other system services legitimately emit NoSuchMethodException and
  # ClassNotFoundException warnings that are unrelated to MobiGPT.
  grep -E "${PACKAGE_ID}|ReactNativeJS|SoLoader|Hermes|CxxInspectorPackagerConnection|InspectorFlags|Force finishing activity ${PACKAGE_ID}" "$log_file" >> "$app_log" || true

  if grep -Eq 'FATAL EXCEPTION|ClassNotFoundException|NoSuchMethodException|UnsatisfiedLinkError|SIGSEGV|SIGABRT|Abort message|ExceptionInInitializerError|Force finishing activity' "$app_log"; then
    cat "$app_log" >&2
    fail "fatal runtime signature detected on attempt $attempt"
  fi

  if ! "${ADB[@]}" shell pidof "$PACKAGE_ID" | tr -d '\r' | grep -Eq '[0-9]'; then
    cat "$start_file" >&2
    cat "$app_log" >&2
    fail "process $PACKAGE_ID did not survive $WAIT_SECONDS seconds on attempt $attempt"
  fi
}

run_attempt 1
run_attempt 2

CURRENT_ATTEMPT="complete"
collect_diagnostics "success"
echo "PASS: $PACKAGE_ID survived two cold starts with ${WAIT_SECONDS}s observation windows"
