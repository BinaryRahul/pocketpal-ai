#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: inspect-apk.sh <apk> <expected-abi> [report-file]

Validates the exact optimized MobiGPT APK that will be installed or distributed.
Requires aapt2 or aapt from the Android SDK build-tools and unzip.
EOF
  exit 2
}

[[ $# -ge 2 && $# -le 3 ]] || usage
APK=$1
EXPECTED_ABI=$2
REPORT=${3:-/dev/stdout}
PACKAGE_ID=${PACKAGE_ID:-com.pocketpallite}
LABEL=${LABEL:-MobiGPT}
LAUNCHER=${LAUNCHER:-com.pocketpal.MainActivity}

[[ -f "$APK" ]] || { echo "APK not found: $APK" >&2; exit 1; }
command -v unzip >/dev/null || { echo "unzip is required" >&2; exit 1; }

AAPT=${AAPT2:-}
if [[ -z "$AAPT" ]]; then
  if command -v aapt2 >/dev/null 2>&1; then
    AAPT=aapt2
  elif command -v aapt >/dev/null 2>&1; then
    AAPT=aapt
  else
    echo "aapt2 or aapt is required; set AAPT2 to its absolute path" >&2
    exit 1
  fi
fi

BADGING=$($AAPT dump badging "$APK")
ZIP_LIST=$(unzip -Z1 "$APK")

failures=()
require_text() {
  local description=$1
  local needle=$2
  local haystack=$3
  if ! grep -Fq -- "$needle" <<<"$haystack"; then
    failures+=("$description: missing '$needle'")
  fi
}

PACKAGE_LINE=$(grep -E "^package: name='" <<<"$BADGING" | head -n 1 || true)
LABEL_LINE=$(grep -E "^application-label(:|-)" <<<"$BADGING" | head -n 1 || true)
LAUNCHER_LINE=$(grep -E "^launchable-activity: name='" <<<"$BADGING" | head -n 1 || true)
VERSION_LINE=$(grep -E "^package: .*versionCode='.*versionName='" <<<"$BADGING" | head -n 1 || true)

require_text "application ID" "name='$PACKAGE_ID'" "$PACKAGE_LINE"
require_text "user-visible label" "'$LABEL'" "$LABEL_LINE"
require_text "launcher activity" "name='$LAUNCHER'" "$LAUNCHER_LINE"
[[ -n "$VERSION_LINE" ]] || failures+=("version metadata: package badging did not expose versionCode/versionName")

mapfile -t ACTUAL_ABIS < <(awk -F/ '$1 == "lib" && NF >= 2 {print $2}' <<<"$ZIP_LIST" | sort -u)
if [[ ${#ACTUAL_ABIS[@]} -ne 1 || ${ACTUAL_ABIS[0]} != "$EXPECTED_ABI" ]]; then
  failures+=("ABI contents: expected only '$EXPECTED_ABI', found '${ACTUAL_ABIS[*]:-none}'")
fi

# React Native release bundles are packaged under assets. Keep this check broad
# enough for Hermes bundle layout changes, but strict enough to catch a missing JS payload.
if ! grep -Eq '^assets/.*index\.android\.bundle($|\.)' <<<"$ZIP_LIST"; then
  failures+=("JavaScript bundle: no assets/*index.android.bundle asset found")
fi

for library in libappmodules.so libhermesvm.so libreactnative.so libfbjni.so libc++_shared.so; do
  if ! grep -Fq "lib/$EXPECTED_ABI/$library" <<<"$ZIP_LIST"; then
    failures+=("native library: missing lib/$EXPECTED_ABI/$library")
  fi
done

{
  echo "MobiGPT APK inspection"
  echo "APK: $APK"
  echo "SHA-256: $(sha256sum "$APK" | awk '{print $1}')"
  echo "Size: $(stat -c '%s bytes' "$APK")"
  echo "Expected ABI: $EXPECTED_ABI"
  echo "Actual ABI(s): ${ACTUAL_ABIS[*]:-none}"
  echo "Package: $PACKAGE_LINE"
  echo "Label: $LABEL_LINE"
  echo "Launcher: $LAUNCHER_LINE"
  echo "Version: $VERSION_LINE"
  echo "Native libraries: libappmodules.so libhermesvm.so libreactnative.so libfbjni.so libc++_shared.so"
  if ((${#failures[@]} == 0)); then
    echo "RESULT: PASS"
  else
    echo "RESULT: FAIL"
    printf 'FAIL: %s\n' "${failures[@]}"
  fi
} > "$REPORT"

if ((${#failures[@]} != 0)); then
  cat "$REPORT" >&2
  exit 1
fi

cat "$REPORT"
