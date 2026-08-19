#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: validate-r8-contracts.sh <contracts-file> <mapping-dir> [report-file]

Checks that runtime-contract classes are retained by R8. Wildcards ending in
'*' are treated as prefix contracts so nested generated classes are covered.
EOF
  exit 2
}

[[ $# -ge 2 && $# -le 3 ]] || usage
CONTRACTS=$1
MAPPING_DIR=$2
REPORT=${3:-/dev/stdout}
SEEDS=${SEEDS_FILE:-$MAPPING_DIR/seeds.txt}
MISSING_RULES=${MISSING_RULES_FILE:-$MAPPING_DIR/missing_rules.txt}

[[ -f "$CONTRACTS" ]] || { echo "Contracts file not found: $CONTRACTS" >&2; exit 1; }
[[ -f "$SEEDS" ]] || { echo "R8 seeds file not found: $SEEDS" >&2; exit 1; }

failures=()
checked=0
while IFS= read -r contract || [[ -n "$contract" ]]; do
  contract=${contract%%#*}
  contract=$(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' <<<"$contract")
  [[ -z "$contract" ]] && continue
  checked=$((checked + 1))

  if [[ "$contract" == *'*' ]]; then
    prefix=${contract%%\**}
    if ! grep -Fq "$prefix" "$SEEDS"; then
      failures+=("$contract: prefix '$prefix' not found in seeds.txt")
    fi
  elif ! grep -Fq "$contract" "$SEEDS"; then
    failures+=("$contract: not found in seeds.txt")
  fi
done < "$CONTRACTS"

# AGP/R8 can emit missing_rules.txt even when the APK compiles. Treat a
# non-empty report as a review gate, while tolerating an absent report.
missing_count=0
if [[ -f "$MISSING_RULES" ]]; then
  missing_count=$(grep -Ev '^[[:space:]]*(#|$)' "$MISSING_RULES" | wc -l | tr -d ' ')
  if ((missing_count > 0)); then
    failures+=("missing_rules.txt contains $missing_count non-comment rule(s)")
  fi
fi

{
  echo "MobiGPT R8 runtime-contract validation"
  echo "Contracts: $CONTRACTS"
  echo "Seeds: $SEEDS"
  echo "Missing rules: ${MISSING_RULES} (${missing_count} non-comment lines)"
  echo "Contracts checked: $checked"
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
