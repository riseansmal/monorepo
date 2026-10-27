#!/usr/bin/env bash
set -uo pipefail

# Read-only local exposure assertion. Never resolve an AWS provider or identity.
PASS=0
WARN=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
warn() { WARN=$((WARN + 1)); printf 'WARN  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL  %s\n' "$1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1
# shellcheck source=tooling/scripts/security/aws-exposure.sh
source "$SCRIPT_DIR/aws-exposure.sh" || exit 1
printf '%s\n' 'monorepo AWS local credential-exposure check'
if command -v aws >/dev/null 2>&1 && aws --version; then
  pass "AWS CLI version command available (no authentication)"
else
  fail "AWS CLI version command unavailable"
fi
monorepo_aws_exposure_check || true # callbacks already record every failure
printf '\nPASS: %d\nWARN: %d\nFAIL: %d\n' "$PASS" "$WARN" "$FAIL"
if (( FAIL > 0 )); then
  printf '%s\n' 'AWS EXPOSURE CHECK FAILED'
  exit 1
fi
printf '%s\n' 'AWS EXPOSURE CHECK PASSED (review any bounded-scope warnings)'
