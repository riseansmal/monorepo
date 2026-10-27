#!/usr/bin/env bash
set -euo pipefail

# monorepo — remove local AWS credentials/configuration from this macOS user.
#
# DESTRUCTIVE:
# - Deletes ~/.aws/credentials and ~/.aws/config if present.
# - Deletes legacy ~/.aws/cli/cache and ~/.aws/sso/cache data.
# - Removes common AWS credential/config environment exports from the current
#   process only; persistent shell exports must be removed manually if detected
#   by the companion check script.
# - Does NOT delete IAM users, access keys, roles, SSO assignments, or anything
#   in the AWS account itself.
# - Does NOT modify macOS Keychain or third-party credential managers.

AWS_DIR="${HOME}/.aws"

# Never traverse a linked parent into another credential store or directory.
for parent in "$AWS_DIR" "$AWS_DIR/cli" "$AWS_DIR/sso"; do
  if [[ -L "$parent" ]]; then
    echo "Refusing cleanup through a symlink parent: $parent" >&2
    exit 2
  fi
done

echo "monorepo AWS local credential purge"
echo
echo "This permanently removes local AWS CLI credentials/config/cache under:"
echo "  ${AWS_DIR}"
echo
echo "It does NOT revoke or delete credentials in AWS itself."
echo

read -r -p 'Type DELETE-LOCAL-AWS to continue: ' CONFIRM
if [[ "$CONFIRM" != "DELETE-LOCAL-AWS" ]]; then
  echo "Aborted."
  exit 1
fi

targets=(
  "$AWS_DIR/credentials"
  "$AWS_DIR/config"
  "$AWS_DIR/cli/cache"
  "$AWS_DIR/sso/cache"
)

for target in "${targets[@]}"; do
  if [[ -e "$target" ]]; then
    rm -rf -- "$target"
    echo "Removed: $target"
  else
    echo "Not present: $target"
  fi
done

# Remove ~/.aws only if nothing remains. Preserve unknown files rather than
# deleting them blindly.
if [[ -d "$AWS_DIR" ]]; then
  if [[ -z "$(find "$AWS_DIR" -mindepth 1 -print -quit 2>/dev/null)" ]]; then
    rmdir "$AWS_DIR"
    echo "Removed empty directory: $AWS_DIR"
  else
    echo
    echo "WARNING: ${AWS_DIR} still contains files not explicitly targeted."
    echo "They were preserved. Review with:"
    echo "  find \"$AWS_DIR\" -maxdepth 3 -type f -print"
  fi
fi

unset AWS_ACCESS_KEY_ID 2>/dev/null || true
unset AWS_SECRET_ACCESS_KEY 2>/dev/null || true
unset AWS_SESSION_TOKEN 2>/dev/null || true
unset AWS_SECURITY_TOKEN 2>/dev/null || true
unset AWS_PROFILE 2>/dev/null || true
unset AWS_DEFAULT_PROFILE 2>/dev/null || true
unset AWS_SHARED_CREDENTIALS_FILE 2>/dev/null || true
unset AWS_CONFIG_FILE 2>/dev/null || true
unset AWS_WEB_IDENTITY_TOKEN_FILE 2>/dev/null || true
unset AWS_ROLE_ARN 2>/dev/null || true
unset AWS_CONTAINER_CREDENTIALS_RELATIVE_URI 2>/dev/null || true
unset AWS_CONTAINER_CREDENTIALS_FULL_URI 2>/dev/null || true

echo
echo "Local AWS CLI credential/config purge complete."
echo "Run the companion monorepo-aws-credential-check.sh script next."
