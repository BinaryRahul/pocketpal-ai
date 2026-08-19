#!/usr/bin/env bash
set -Eeuo pipefail

if (($# == 0)); then
  echo "Usage: retry-gradle.sh <gradle-command> [args...]" >&2
  exit 2
fi

attempts=${GRADLE_MAX_ATTEMPTS:-4}
delay=${GRADLE_RETRY_DELAY_SECONDS:-30}
last_status=1

for ((attempt = 1; attempt <= attempts; attempt++)); do
  echo "Gradle attempt $attempt/$attempts: $*"
  if "$@"; then
    exit 0
  else
    last_status=$?
  fi
  if ((attempt < attempts)); then
    echo "Gradle failed with status $last_status; retrying in ${delay}s" >&2
    sleep "$delay"
    delay=$((delay * 2))
  fi
done

exit "$last_status"
