#!/usr/bin/env bash
set -uo pipefail

# monorepo macOS workstation preflight
#
# Purpose:
# - Verify a macOS workstation is ready to build and operate the monorepo workspace.
# - Validate the Homebrew workstation baseline and critical native toolchains.
# - Distinguish required failures from optional/environment-specific warnings.
# - Remain safe and deterministic when committed to the monorepo repository.
#
# Usage:
#   chmod +x ./monorepo-macos-preflight.sh
#   ./monorepo-macos-preflight.sh
#
# Optional Brewfile path:
#   ./monorepo-macos-preflight.sh /path/to/Brewfile
#
# Environment override:
#   MONOREPO_BREWFILE=/path/to/Brewfile ./monorepo-macos-preflight.sh
#
# Exit codes:
#   0 = all required workstation checks passed (warnings may remain)
#   1 = one or more required checks failed

BREWFILE_PATH="${MONOREPO_BREWFILE:-${1:-$HOME/Brewfile}}"

PASS=0
WARN=0
FAIL=0

umask 077
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/monorepo-preflight.XXXXXX")" || exit 1
# Retain private diagnostics at the unique path printed by failed checks.

if [[ -t 1 ]]; then
  BOLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  RED="$(printf '\033[31m')"
  CYAN="$(printf '\033[36m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""
  DIM=""
  GREEN=""
  YELLOW=""
  RED=""
  CYAN=""
  RESET=""
fi

pass() {
  PASS=$((PASS + 1))
  printf "%bPASS%b  %s\n" "$GREEN" "$RESET" "$1"
}

warn() {
  WARN=$((WARN + 1))
  printf "%bWARN%b  %s\n" "$YELLOW" "$RESET" "$1"
}

fail() {
  FAIL=$((FAIL + 1))
  printf "%bFAIL%b  %s\n" "$RED" "$RESET" "$1"
}

section() {
  printf "\n%b%s%b\n" "$BOLD$CYAN" "$1" "$RESET"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

first_line() {
  "$@" 2>/dev/null | head -n1 || true
}

prepend_path_if_dir() {
  local directory="$1"

  if [[ -n "$directory" && -d "$directory" ]]; then
    case ":$PATH:" in
      *":$directory:"*) ;;
      *) PATH="$directory:$PATH" ;;
    esac
  fi
}

# -----------------------------------------------------------------------------
# Normalize Homebrew and keg-only toolchain paths.
#
# This intentionally makes the script independent of the user's interactive
# shell profile. Homebrew's rustup, PostgreSQL 18, and LLVM installations can
# expose required binaries from keg-specific bin directories that are not
# necessarily present in a non-interactive PATH.
# -----------------------------------------------------------------------------

if command -v brew >/dev/null 2>&1; then
  BREW_PREFIX="$(brew --prefix 2>/dev/null || true)"

  if [[ -n "$BREW_PREFIX" ]]; then
    prepend_path_if_dir "$BREW_PREFIX/bin"
    prepend_path_if_dir "$BREW_PREFIX/sbin"
  fi

  RUSTUP_PREFIX="$(brew --prefix rustup 2>/dev/null || true)"
  POSTGRES_PREFIX="$(brew --prefix postgresql@18 2>/dev/null || true)"
  LLVM_PREFIX="$(brew --prefix llvm 2>/dev/null || true)"

  prepend_path_if_dir "${RUSTUP_PREFIX:+$RUSTUP_PREFIX/bin}"
  prepend_path_if_dir "$HOME/.cargo/bin"
  prepend_path_if_dir "${POSTGRES_PREFIX:+$POSTGRES_PREFIX/bin}"
  prepend_path_if_dir "${LLVM_PREFIX:+$LLVM_PREFIX/bin}"

  export PATH
fi

check_cmd() {
  local cmd="$1"
  local label="${2:-$1}"

  if have "$cmd"; then
    local version=""
    case "$cmd" in
      git) version="$(first_line git --version)" ;;
      gh) version="$(first_line gh --version)" ;;
      node) version="node $(node --version 2>/dev/null)" ;;
      pnpm) version="pnpm $(pnpm --version 2>/dev/null)" ;;
      python3) version="$(first_line python3 --version)" ;;
      uv) version="$(first_line uv --version)" ;;
      ruff) version="$(first_line ruff --version)" ;;
      pyright) version="$(first_line pyright --version)" ;;
      cargo) version="$(first_line cargo --version)" ;;
      rustc) version="$(first_line rustc --version)" ;;
      rustup) version="$(first_line rustup --version)" ;;
      docker) version="$(first_line docker --version)" ;;
      colima) version="$(first_line colima version)" ;;
      tofu) version="$(first_line tofu version)" ;;
      ansible) version="$(first_line ansible --version)" ;;
      ollama) version="$(first_line ollama --version)" ;;
      aws) version="$(aws --version 2>&1 | head -n1 || true)" ;;
      actionlint) version="$(first_line actionlint -version)" ;;
      hadolint) version="$(first_line hadolint --version)" ;;
      yamllint) version="$(first_line yamllint --version)" ;;
      *) version="$("$cmd" --version 2>/dev/null | head -n1 || true)" ;;
    esac

    if [[ -n "$version" ]]; then
      pass "$label — $version"
    else
      pass "$label"
    fi
  else
    fail "$label is not installed or not on PATH"
  fi
}

check_optional_cmd() {
  local cmd="$1"
  local label="${2:-$1}"

  if have "$cmd"; then
    local version
    version="$("$cmd" --version 2>/dev/null | head -n1 || true)"
    if [[ -n "$version" ]]; then
      pass "$label — $version"
    else
      pass "$label"
    fi
  else
    warn "$label is not installed or not on PATH"
  fi
}

check_app() {
  local app="$1"
  local required="${2:-optional}"
  local found=""

  for base in "/Applications" "$HOME/Applications"; do
    if [[ -d "$base/${app}.app" ]]; then
      found="$base/${app}.app"
      break
    fi
  done

  if [[ -n "$found" ]]; then
    pass "$app installed — $found"
  elif [[ "$required" == "required" ]]; then
    fail "$app not found in /Applications or ~/Applications"
  else
    warn "$app not found in /Applications or ~/Applications"
  fi
}

printf "%bmonorepo macOS Workstation Preflight%b\n" "$BOLD" "$RESET"
printf "%bValidates the workstation baseline before monorepo foundation work.%b\n" "$DIM" "$RESET"

section "1. Host"

if [[ "$(uname -s)" == "Darwin" ]]; then
  pass "macOS detected — $(sw_vers -productVersion 2>/dev/null || true)"
else
  fail "This preflight is intended for macOS"
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)
    pass "Apple Silicon detected ($ARCH)"
    ;;
  x86_64)
    warn "Intel Mac detected; some monorepo AI/Apple Silicon workflows will differ"
    ;;
  *)
    warn "Unexpected CPU architecture: $ARCH"
    ;;
esac

if have xcode-select && xcode-select -p >/dev/null 2>&1; then
  pass "Active Apple developer directory — $(xcode-select -p)"
else
  fail "Xcode Command Line Tools are not configured"
fi

if [[ -d "/Applications/Xcode.app" ]]; then
  pass "Xcode.app installed"

  if xcodebuild -version >"$TMP_ROOT/xcode-version.txt" 2>&1; then
    pass "xcodebuild available — $(tr '\n' ' ' < "$TMP_ROOT/xcode-version.txt")"
  else
    fail "Xcode is installed but xcodebuild is not usable"
  fi
else
  warn "Xcode.app not installed; native Apple builds will be unavailable"
fi

section "2. Homebrew and Brewfile"

if have brew; then
  pass "Homebrew — $(brew --version | head -n1)"

  if brew doctor >"$TMP_ROOT/brew-doctor.txt" 2>&1; then
    pass "brew doctor reports no blocking issues"
  else
    warn "brew doctor reported issues; inspect $TMP_ROOT/brew-doctor.txt"
  fi
else
  fail "Homebrew is not installed"
fi

if [[ -f "$BREWFILE_PATH" ]]; then
  pass "Brewfile found — $BREWFILE_PATH"

  if have brew; then
    if brew bundle check --file "$BREWFILE_PATH" >"$TMP_ROOT/brew-bundle-check.txt" 2>&1; then
      pass "All Brewfile dependencies are installed"
    else
      fail "Brewfile dependencies are incomplete; run: brew bundle --file \"$BREWFILE_PATH\""
    fi
  fi
else
  warn "Brewfile not found at $BREWFILE_PATH"
fi

section "3. Git and GitHub"

check_cmd git
check_cmd gh
check_cmd git-lfs "Git LFS"

GIT_NAME="$(git config --global user.name 2>/dev/null || true)"
GIT_EMAIL="$(git config --global user.email 2>/dev/null || true)"

if [[ -n "$GIT_NAME" ]]; then
  pass "Git user.name configured — $GIT_NAME"
else
  warn "Git user.name is not configured globally"
fi

if [[ -n "$GIT_EMAIL" ]]; then
  pass "Git user.email configured — $GIT_EMAIL"
else
  warn "Git user.email is not configured globally"
fi

if have gh; then
  if gh auth status >"$TMP_ROOT/gh-auth.txt" 2>&1; then
    pass "GitHub CLI authenticated"
  else
    fail "GitHub CLI is not authenticated; run: gh auth login"
  fi
fi

section "4. Core CLI tooling"

for cmd in jq yq tree watch wget curl rg fd fzf bat eza zoxide direnv shellcheck shfmt just; do
  check_cmd "$cmd"
done

section "5. Node / TypeScript"

check_cmd node
check_cmd pnpm

if have node; then
  NODE_PIN_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/.node-version"
  NODE_CURRENT="$(node -p 'process.versions.node' 2>/dev/null || echo unavailable)"
  if [[ ! -r "$NODE_PIN_FILE" ]]; then
    fail "Repository .node-version is required to validate the Node baseline"
  else
    NODE_REQUIRED="$(tr -d '[:space:]' < "$NODE_PIN_FILE")"
    if [[ "$NODE_CURRENT" == "$NODE_REQUIRED" ]]; then
      pass "Node.js matches the pinned repository version: $NODE_REQUIRED"
    else
      fail "Node.js $NODE_REQUIRED required; current version: $NODE_CURRENT"
    fi
  fi
fi

section "6. Python"

check_cmd python3 "Python"
check_cmd uv
check_cmd ruff
check_cmd pyright

if have uv; then
  if uv python find >"$TMP_ROOT/uv-python.txt" 2>&1; then
    pass "uv can resolve a Python interpreter — $(head -n1 "$TMP_ROOT/uv-python.txt")"
  else
    fail "uv is installed but cannot resolve a Python interpreter"
  fi
fi

section "7. Rust / native build"

check_cmd rustup "rustup"
check_cmd rustc "rustc"
check_cmd cargo "Cargo"
check_cmd cmake
check_cmd ninja
check_cmd pkg-config "pkg-config"
check_cmd llvm-config "LLVM"

if have rustup && have rustc && have cargo; then
  if ACTIVE_TOOLCHAIN="$(rustup show active-toolchain 2>/dev/null)"; then
    pass "Rust toolchain initialized — $ACTIVE_TOOLCHAIN"
  else
    fail "rustup is installed but no active Rust toolchain is configured; run: rustup default stable"
  fi
fi

section "8. Apple / mobile tooling"

check_cmd watchman
check_cmd pod "CocoaPods"
check_cmd fastlane

check_app "Cursor" "required"
check_app "Visual Studio Code"
check_app "WezTerm"

section "9. API / schema / networking"

check_cmd protoc "Protocol Buffers compiler"
check_cmd buf
check_cmd grpcurl
check_cmd http "HTTPie"

section "10. Databases / queues"

check_cmd psql "PostgreSQL client"
check_cmd redis-cli "Redis CLI"

section "11. Containers"

check_cmd colima

if have docker; then
  pass "Docker CLI available — $(docker --version 2>/dev/null | head -n1)"

  if docker compose version >"$TMP_ROOT/docker-compose.txt" 2>&1; then
    pass "Docker Compose available — $(docker compose version 2>/dev/null)"
  else
    warn "Docker Compose is not currently available through the active Docker CLI"
  fi

  if docker buildx version >"$TMP_ROOT/docker-buildx.txt" 2>&1; then
    pass "Docker Buildx available"
  else
    warn "Docker Buildx is not currently available through the active Docker CLI"
  fi

  if docker info >"$TMP_ROOT/docker-info.txt" 2>&1; then
    pass "Docker daemon is reachable"
  else
    warn "Docker CLI is available but no daemon is reachable; start Docker Desktop or Colima when needed"
  fi
else
  warn "Docker CLI is not currently on PATH. Docker Desktop should provide it when installed/running."
fi

check_app "Docker" "required"

section "12. Kubernetes tooling"

check_cmd helm
check_cmd kind
check_cmd kubeconform
check_cmd kustomize

section "13. Infrastructure / cloud"

check_cmd tofu "OpenTofu"
check_cmd ansible
check_cmd aws "AWS CLI"
check_cmd terraform-docs
check_cmd sops
check_cmd age

# TFLint is intentionally not Homebrew-managed in the monorepo Brewfile.
check_optional_cmd tflint "TFLint (optional)"

# One canonical, local presence-only safety check; never resolve AWS providers.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1
# shellcheck source=tooling/scripts/security/aws-exposure.sh
source "$SCRIPT_DIR/security/aws-exposure.sh" || exit 1
monorepo_aws_exposure_check || true # callbacks already record every failure

section "14. Security / supply chain"

check_cmd gitleaks
check_cmd pre-commit
check_cmd trivy

section "15. Quality / validation"

check_cmd actionlint
check_cmd hadolint
check_cmd yamllint

section "16. AI / local inference"

check_cmd ollama

if have ollama; then
  if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >"$TMP_ROOT/ollama-tags.json" 2>/dev/null; then
    pass "Ollama API reachable on localhost:11434"
  else
    warn "Ollama installed but API is not running; start it with: brew services start ollama"
  fi
fi

check_app "LM Studio"

section "17. Media utilities"

check_cmd ffmpeg
check_cmd magick "ImageMagick"
check_cmd exiftool

section "18. Optional workstation applications"

check_app "TablePlus"
check_app "Postman"
check_app "GitKraken"
check_app "DataGrip"
check_app "Ghostty"
check_app "Warp"

section "19. Creative / manual-install tools"

if [[ -d "/Applications/DaVinci Resolve.app" || -d "/Applications/DaVinci Resolve Studio.app" ]]; then
  pass "DaVinci Resolve detected"
else
  warn "DaVinci Resolve not detected (optional for monorepo foundation build)"
fi

if [[ -d "/Applications/Native Access.app" ]]; then
  pass "Native Instruments Native Access detected"
else
  warn "Native Access not detected (optional for monorepo foundation build)"
fi

section "20. monorepo repository context"

# Repository-specific checks activate only when executed from inside a Git repo.
if git rev-parse --show-toplevel >"$TMP_ROOT/repo-root.txt" 2>/dev/null; then
  REPO_ROOT="$(cat "$TMP_ROOT/repo-root.txt")"
  pass "Git repository detected — $REPO_ROOT"

  if [[ -f "$REPO_ROOT/docs/architecture/monorepo-foundation-architecture-v1.md" ]]; then
    pass "Foundation architecture document present"
  else
    warn "Foundation architecture document not found under docs/architecture/"
  fi

  if [[ -f "$REPO_ROOT/docs/architecture/monorepo-implementation-skeleton-v1.md" ]]; then
    pass "Implementation skeleton document present"
  else
    warn "Implementation skeleton document not found under docs/architecture/"
  fi

  if [[ -f "$REPO_ROOT/docs/architecture/monorepo-change-control-and-release-governance-v1.md" ]]; then
    pass "Change-control and release-governance document present"
  else
    warn "Change-control and release-governance document not found under docs/architecture/"
  fi

  if [[ -f "$REPO_ROOT/CONTRIBUTING.md" ]]; then
    pass "Master build prompt present"
  else
    warn "Master build prompt not found under docs/bootstrap/"
  fi

  if git remote get-url origin >"$TMP_ROOT/origin.txt" 2>/dev/null; then
    pass "Git origin configured — $(cat "$TMP_ROOT/origin.txt")"
  else
    warn "Git origin is not configured"
  fi
else
  warn "Not currently running inside a Git repository; repository-specific checks skipped"
fi

section "21. Readiness summary"

printf "\n%bPASS:%b %d\n" "$GREEN" "$RESET" "$PASS"
printf "%bWARN:%b %d\n" "$YELLOW" "$RESET" "$WARN"
printf "%bFAIL:%b %d\n" "$RED" "$RESET" "$FAIL"

if (( FAIL > 0 )); then
  printf "\n%bNOT READY%b — fix the failed checks before handing the monorepo foundation build to the coding agent.\n" "$RED$BOLD" "$RESET"
  exit 1
fi

printf "\n%bREADY%b — all required workstation checks passed." "$GREEN$BOLD" "$RESET"

if (( WARN > 0 )); then
  printf " Review the warnings; they are non-blocking unless they apply to the work you are about to perform."
fi

printf "\n"
exit 0
