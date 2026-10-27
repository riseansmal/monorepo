#!/usr/bin/env bash
# Sourced by preflight and the standalone check. Callbacks: pass, warn, fail.
# Inspect only presence, never values/content, providers, tokens or identities.
monorepo_aws_exposure_check() {
  local found=0 name entry aws_dir
  if [[ -z "${HOME:-}" || "$HOME" != /* || ! -d "$HOME" ]]; then
    fail "A valid absolute HOME is required for AWS exposure checks"
    return 1
  fi
  aws_dir="$HOME/.aws"
  local names=(
    AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_SECURITY_TOKEN
    AWS_ACCESS_KEY AWS_SECRET_KEY AWS_CREDENTIAL_FILE
    AWS_PROFILE AWS_DEFAULT_PROFILE AWS_SHARED_CREDENTIALS_FILE AWS_CONFIG_FILE
    AWS_WEB_IDENTITY_TOKEN_FILE AWS_ROLE_ARN AWS_ROLE_SESSION_NAME
    AWS_CONTAINER_CREDENTIALS_RELATIVE_URI AWS_CONTAINER_CREDENTIALS_FULL_URI
    AWS_CONTAINER_AUTHORIZATION_TOKEN AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE
    AWS_LOGIN_CACHE_DIRECTORY BOTO_CONFIG BOTO_PATH
  )
  for name in "${names[@]}"; do
    # +x checks whether set, including an empty value; no value is inspected.
    if [[ "${!name+x}" == x ]]; then
      fail "Credential/profile environment variable is set (value not read): $name"
      found=1
    fi
  done
  if (( found == 0 )); then
    pass "No checked AWS credential/profile environment variables are set"
  fi

  if [[ -L "$aws_dir" || ( -e "$aws_dir" && ! -d "$aws_dir" ) ]]; then
    fail "Home-directory AWS state is a symlink or non-directory; contents not followed or read"
    found=1
  elif [[ -d "$aws_dir" && ! -x "$aws_dir" ]]; then
    fail "Home-directory AWS state cannot be searched for known path existence; contents not read"
    found=1
  else
    for entry in cli sso login; do
      if [[ -L "$aws_dir/$entry" || ( -e "$aws_dir/$entry" && ! -d "$aws_dir/$entry" ) || ( -d "$aws_dir/$entry" && ! -x "$aws_dir/$entry" ) ]]; then
        fail "AWS cache parent is unsafe or unsearchable (not followed): ~/.aws/$entry"
        return 1
      fi
    done
    for entry in credentials config cli/cache sso/cache login/cache; do
      if [[ -e "$aws_dir/$entry" || -L "$aws_dir/$entry" ]]; then
        fail "Known AWS source path exists (contents not read): ~/.aws/$entry"
        found=1
      else
        pass "Known AWS source path absent: ~/.aws/$entry"
      fi
    done
    if [[ -e "$aws_dir" ]]; then
      warn "Home-directory AWS state exists; other state may include CLI session metadata. Not enumerated or read; no claim that it is empty or credential-free."
    else
      pass "Home-directory AWS state is absent"
    fi
  fi
  for entry in "$HOME/.boto" /etc/boto.cfg; do
    if [[ -e "$entry" || -L "$entry" ]]; then
      fail "Legacy Boto configuration path exists (contents not read)"
      found=1
    fi
  done
  if (( found > 0 )); then
    return 1
  fi
  pass "No AWS credential source is intentionally exposed to coding agents by the known local environment/config paths checked"
  printf '%s\n' 'Scope: presence checks only; shell contents, Keychain, other credential stores and arbitrary machine paths are not inspected. This is not universal proof of credential absence.'
}
