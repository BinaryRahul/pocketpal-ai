#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: inspect-apks-set.sh <extracted-apk-dir> <expected-abi> [report-file]

Inspects all APK splits extracted from a bundletool .apks archive. The set is
expected to contain the package and launch metadata in its base APK and the
requested native ABI in at least one split.
EOF
  exit 2
}

[[ $# -ge 2 && $# -le 3 ]] || usage
APK_DIR=$1
EXPECTED_ABI=$2
REPORT=${3:-/dev/stdout}
PACKAGE_ID=${PACKAGE_ID:-com.pocketpallite}
LABEL=${LABEL:-MobiGPT}
LAUNCHER=${LAUNCHER:-com.pocketpal.MainActivity}
AAPT=${AAPT2:-}
if [[ -z "$AAPT" ]]; then
  command -v aapt2 >/dev/null 2>&1 && AAPT=aapt2 || command -v aapt >/dev/null 2>&1 && AAPT=aapt || {
    echo "aapt2 or aapt is required; set AAPT2 to its absolute path" >&2
    exit 1
  }
fi

mapfile -t APKS < <(find "$APK_DIR" -type f -name '*.apk' -print | sort)
[[ ${#APKS[@]} -gt 0 ]] || { echo "No extracted APKs found in $APK_DIR" >&2; exit 1; }

failures=()
base_seen=0
abi_seen=0
for apk in "${APKS[@]}"; do
  badging=$($AAPT dump badging "$apk")
  zip_list=$(unzip -Z1 "$apk")
  package_line=$(grep -E '^package:' <<<"$badging" || true)
  if grep -Fq "name='$PACKAGE_ID'" <<<"$package_line"; then
    # A bundletool set contains multiple base/configuration splits. The base
    # split is identified by the package metadata; only it should be required
    # to expose label, launcher, and version metadata.
    if ((base_seen == 0)); then
      base_seen=1
      grep -Fq "'$LABEL'" <<<"$(grep -E '^application-label' <<<"$badging" || true)" || failures+=("$apk: expected label '$LABEL'")
      grep -Fq "name='$LAUNCHER'" <<<"$(grep -E '^launchable-activity:' <<<"$badging" || true)" || failures+=("$apk: expected launcher '$LAUNCHER'")
      grep -Eq '^package: .*versionCode=.*versionName=' <<<"$badging" || failures+=("$apk: missing version metadata")
    fi
  fi
  if grep -Fq "lib/$EXPECTED_ABI/" <<<"$zip_list"; then
    abi_seen=1
  fi

done

# Split APK sets distribute native libraries among configuration splits, so the
# ABI is expected in at least one member rather than in the base APK alone.
((base_seen == 1)) || failures+=("no base split exposed package ID '$PACKAGE_ID'")
((abi_seen == 1)) || failures+=("no split contained lib/$EXPECTED_ABI native libraries")

{
  echo "MobiGPT bundletool APK-set inspection"
  echo "APK directory: $APK_DIR"
  echo "Split count: ${#APKS[@]}"
  echo "Expected ABI: $EXPECTED_ABI"
  echo "Base package found: $base_seen"
  echo "Expected ABI found: $abi_seen"
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
