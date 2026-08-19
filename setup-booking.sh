#!/usr/bin/env bash
# =============================================================================
#  Smash Zone Booking — dev environment bootstrap  (any Debian-based distro)
# -----------------------------------------------------------------------------
#  Takes a FRESH OS install to "can run the app, talk to the database, commit
#  and deploy". Safe to re-run: every step skips what is already in place.
#
#  SUPPORTED
#    Any Debian derivative (Debian, Ubuntu, Mint, Pop!_OS, ...) on x86_64 or
#    arm64, under WSL2 or on bare metal / a VM, desktop or headless.
#    Run it as your NORMAL user — not with sudo; it escalates per command so
#    your SSH key, npm cache and the checkout stay owned by you.
#
#  WHAT THIS PROJECT ACTUALLY NEEDS (verified against the repo, not assumed)
#    Node.js 22 LTS
#        next 16.3 needs >=20.9, but prisma 7.9 needs ^20.19 || ^22.12 || >=24.
#        Node 22 is the lowest line satisfying BOTH. Note this excludes 21.x and
#        23.x entirely, and 22.0-22.11 — the check below enforces the real range
#        rather than a lazy ">= 20".
#    NO database server
#        The datasource is PostgreSQL, but it is hosted on Neon — nothing to
#        install locally. DATABASE_URL points at Neon (or a Neon branch).
#    NO Rust, no protoc, no build toolchain
#        Pure TypeScript/Next.js. `build-essential` is deliberately NOT
#        installed: nothing here compiles native code.
#    .env.local, copied from the committed .env.example
#        Next.js's local-env convention, and what docs/backups-and-calendar.md
#        references. .env.example is the single source of truth for the variable
#        list and is NOT gitignored (there is a '!.env.example' negation), so a
#        fresh clone can see what needs filling in. NEXTAUTH_SECRET is generated
#        and DATABASE_URL is prompted for, with a link to where to get it and a
#        live connection test. An existing .env.local is never overwritten.
#    GitHub CLI (gh)
#        The repo is PUBLIC, so the clone itself needs no credentials and a
#        fresh machine bootstraps unauthenticated. gh is still installed and
#        offered BEFORE the clone, because its login flow uploads your SSH key
#        for you — which is what makes `git push` work afterwards.
#
#  OPT-IN EXTRAS (off by default — none needed for the daily dev loop)
#    --with-vercel    Vercel CLI, for deploys and pulling env vars from the
#                     project settings (`vercel env pull .env.local`).
#    --with-pgclient  PostgreSQL 17 client (psql + pg_dump), for the backup and
#                     restore flows in docs/backups-and-calendar.md. Pinned to
#                     17 from PostgreSQL's own apt repo because pg_dump refuses
#                     to dump a server newer than itself and Neon runs 17 — the
#                     exact trap .github/workflows/backup.yml documents.
#    --verify         run `npx next build` at the end to prove the app compiles.
#
#  SKIP FLAGS
#    --no-node  --no-gh  --no-git  --no-install  --no-env
#
#  INSTALL ON A FRESH MACHINE (one line, nothing pre-installed)
#      curl -fsSL https://raw.githubusercontent.com/orapagier/ilovepickleball/main/setup-booking.sh | bash
#
#    The default branch is `main`.
#    To pass flags through the pipe, use `bash -s --`:
#      curl -fsSL .../setup-booking.sh | bash -s -- --with-vercel --with-pgclient
#
#    It installs everything, clones the repo to ~/dev/booking, and configures it.
#    Prompts still work under the pipe: stdin belongs to curl, so every prompt
#    reads from /dev/tty instead. With no terminal at all (CI, cron) it skips
#    the prompts and reports what is left to do rather than hanging.
#
#    Run from inside an existing checkout, it uses that one and clones nothing.
#    --dir PATH   where to clone to (default: ~/dev/booking)
#
#    Two copies exist by design: the one in the repo is canonical and versioned,
#    and a copy in ~/ is what you run before any checkout exists. The script
#    compares them and tells you when the ~/ copy has fallen behind.
#
#  Env overrides:  GIT_NAME, GIT_EMAIL, SSH_PASSPHRASE, BOOKING_DIR, BOOKING_REPO_URL
# =============================================================================
set -euo pipefail

B='\033[1m'; G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; N='\033[0m'
log()  { echo -e "${G}[✓]${N} $*"; }
warn() { echo -e "${Y}[!]${N} $*"; }
err()  { echo -e "${R}[✗]${N} $*" >&2; exit 1; }
info() { echo -e "${C}[→]${N} $*"; }
step() { echo -e "\n${B}━━━ $* ━━━${N}"; }

# Set KEY=VALUE in an env file. No python3 (absent from minimal images) and no
# sed (would mangle '/' and '+' in base64 secrets, and '&' in a connection
# string). The value is only ever a printf ARGUMENT, so it lands byte-exact.
# Writes through `cat >` so the file keeps its inode and 0600 mode.
set_env_var() {
  local file="$1" key="$2" value="$3" tmp line found=0
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$key"=*) printf '%s=%s\n' "$key" "$value"; found=1 ;;
      *)        printf '%s\n' "$line" ;;
    esac
  done < "$file" > "$tmp"
  [ "$found" -eq 0 ] && printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

# Piped execution (`curl … | bash`) has NO source file, so BASH_SOURCE is unset
# and `set -u` would abort here before a single flag is parsed. Everything that
# wants the script's own path has to tolerate that.
# Defined up here, ahead of the sudo guard below: that guard prints $SELF_NAME,
# so under `set -u` a later definition would abort with "unbound variable"
# instead of printing the instruction the user actually needs.
SELF_SRC="${BASH_SOURCE[0]:-}"
SELF_NAME="setup-booking.sh"
SELF_URL="https://raw.githubusercontent.com/orapagier/ilovepickleball/main/setup-booking.sh"
if [ -n "$SELF_SRC" ]; then
  ROOT="$(cd "$(dirname "$SELF_SRC")" && pwd)"
else
  ROOT="$PWD"   # piped: no script dir, so judge the repo from the working dir
fi

# Running the WHOLE script under sudo would leave the checkout, ~/.ssh and the
# npm cache root-owned, so the normal user could neither push nor build.
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  echo "Do not run this with sudo. Run it as $SUDO_USER:" >&2
  echo "    bash $SELF_NAME" >&2
  exit 1
fi
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  echo "Need root: install sudo and add your user to it, or run this as root." >&2
  exit 1
fi

# `curl -fsSL … | bash` binds stdin to the pipe carrying this script, so
# `[ "$INTERACTIVE" = 1 ]` is false and a bare `read` would consume the script's own source
# text. The controlling terminal is still reachable at /dev/tty, so every prompt
# below reads from there instead. Opening it is also the reliable interactivity
# test: with no controlling terminal (CI, cron, a container) the open fails
# outright rather than blocking, whereas `[ -r /dev/tty ]` only stats the node
# and wrongly reports success.
# The braces matter: redirections apply left to right, so a bare
# `exec 3</dev/tty 2>/dev/null` still prints bash's own "No such device or
# address" before the 2>/dev/null takes effect. Grouping silences the probe.
if { exec 3</dev/tty; } 2>/dev/null; then
  exec 3<&-
  INTERACTIVE=1
else
  INTERACTIVE=0
fi

REPO_URL="${BOOKING_REPO_URL:-https://github.com/orapagier/ilovepickleball}"
CLONE_DIR="${BOOKING_DIR:-$HOME/dev/booking}"

show_help() {
  # Under a pipe there is no local file to read the header out of, so pull the
  # canonical copy rather than printing nothing useful.
  if [ -n "$SELF_SRC" ] && [ -r "$SELF_SRC" ]; then
    sed -n '2,/^# =\{20,\}$/p' "$SELF_SRC" | sed 's/^# \{0,1\}//'
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL "$SELF_URL" | sed -n '2,/^# =\{20,\}$/p' | sed 's/^# \{0,1\}//'
  else
    echo "Full options: $SELF_URL"
  fi
}

DO_NODE=1; DO_GH=1; DO_GIT=1; DO_INSTALL=1; DO_ENV=1
W_VERCEL=0; W_PGCLIENT=0; VERIFY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --no-node)      DO_NODE=0 ;;
    --no-gh)        DO_GH=0 ;;
    --no-git)       DO_GIT=0 ;;
    --no-install)   DO_INSTALL=0 ;;
    --no-env)       DO_ENV=0 ;;
    --with-vercel)  W_VERCEL=1 ;;
    --with-pgclient) W_PGCLIENT=1 ;;
    --verify)       VERIFY=1 ;;
    --all)          W_VERCEL=1; W_PGCLIENT=1; VERIFY=1 ;;
    --dir)          [ $# -ge 2 ] || err "--dir needs a PATH"; CLONE_DIR="$2"; shift ;;
    --help|-h)      show_help; exit 0 ;;
    *)              err "unknown flag: $1 (try --help)" ;;
  esac
  shift
done

# ── Preflight ────────────────────────────────────────────────────────────────
step "Preflight"
[ "$(uname -s)" = "Linux" ] || err "This targets Linux/WSL (Debian-based)."
command -v apt-get >/dev/null 2>&1 || err "apt-get not found — Debian-based distros only."
log "host: $(nproc) cores, $(awk '/MemTotal/ {printf "%.1f", $2/1048576}' /proc/meminfo) GiB RAM, $(uname -m)"
if [ -n "$SUDO" ]; then
  sudo -v || err "sudo access is required to install packages."
  # Track the PID rather than using a %1 job spec: job control is off in a
  # non-interactive shell, so %1 is not reliable here.
  ( while true; do sudo -n true; sleep 60; kill -0 "$$" 2>/dev/null || exit; done ) 2>/dev/null &
  SUDO_KEEPALIVE=$!
  trap 'kill "$SUDO_KEEPALIVE" 2>/dev/null || true' EXIT
  log "privileges: sudo as $(id -un)"
else
  log "privileges: running as root"
fi

# ── Base packages ────────────────────────────────────────────────────────────
# Note what is NOT here: no build-essential, no pkg-config. Nothing in this
# project compiles native code, unlike the axon workspace.
APT_LOG="$(mktemp)"
# </dev/null on both, for the same reason ssh gets -n below: under `curl … | bash`
# stdin is this script's own source, and any child that reads it eats the rest.
apt_install() {
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >>"$APT_LOG" 2>&1 </dev/null \
    || { warn "apt-get install failed for: $*"; tail -20 "$APT_LOG" >&2; return 1; }
}
apt_update() { $SUDO apt-get update -qq >>"$APT_LOG" 2>&1 </dev/null || warn "apt-get update reported an error"; }

step "Base packages"
apt_update
apt_install curl ca-certificates gnupg git openssh-client openssl
log "curl, git, openssh-client, openssl"

IS_WSL=0; grep -qi microsoft /proc/version 2>/dev/null && IS_WSL=1
if [ "$IS_WSL" = 1 ] && ! command -v xdg-open >/dev/null 2>&1 && ! command -v wslview >/dev/null 2>&1; then
  # wslu is not packaged for every Ubuntu release, so a shim over WSL interop
  # is more reliable than the package. Lets `gh auth login` open a browser.
  mkdir -p "$HOME/.local/bin"
  cat >"$HOME/.local/bin/xdg-open" <<'SHIM'
#!/usr/bin/env bash
[ $# -ge 1 ] || { echo "usage: xdg-open <url|file>" >&2; exit 2; }
if command -v powershell.exe >/dev/null 2>&1; then
  exec powershell.exe -NoProfile -NonInteractive -Command "Start-Process '$1'"
elif [ -x /mnt/c/Windows/explorer.exe ]; then
  /mnt/c/Windows/explorer.exe "$1"; exit 0
else
  echo "Open this manually: $1" >&2; exit 1
fi
SHIM
  chmod +x "$HOME/.local/bin/xdg-open"
  log "xdg-open shim installed (WSL -> Windows browser)"
fi
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH"
     [ -f "$HOME/.bashrc" ] && ! grep -q '\.local/bin' "$HOME/.bashrc" 2>/dev/null \
       && printf '\n# added by setup-booking.sh\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$HOME/.bashrc" ;;
esac

# ── GitHub CLI ───────────────────────────────────────────────────────────────
# Before the clone, deliberately: gh's login flow offers to upload the SSH key,
# and it also carries credentials if this repo is ever flipped to private.
if [ "$DO_GH" = 1 ]; then
  step "GitHub CLI"
  if command -v gh >/dev/null 2>&1; then
    log "gh present: $(gh --version | head -1 | awk '{print $3}')"
  else
    info "installing gh (codename-independent 'stable' suite)"
    $SUDO mkdir -p -m 755 /etc/apt/keyrings
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | $SUDO tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
    $SUDO chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | $SUDO tee /etc/apt/sources.list.d/github-cli.list >/dev/null
    apt_update
    apt_install gh
  fi
  if gh auth status >/dev/null 2>&1; then
    log "gh authenticated"
  else
    warn "gh is not authenticated (the clone works without it — this repo is public;"
    warn "  logging in lets gh upload your SSH key, which is what 'git push' needs)."
    if [ "$INTERACTIVE" = 1 ]; then
      read -r -p "  Run 'gh auth login' now? [Y/n] " ans < /dev/tty
      case "${ans:-y}" in
        [Yy]*) gh auth login --hostname github.com --git-protocol ssh --web < /dev/tty || warn "gh login did not complete" ;;
      esac
    fi
  fi
fi

# ── Repository ───────────────────────────────────────────────────────────────
step "Repository"
is_booking_repo() { [ -f "$1/package.json" ] && [ -f "$1/prisma/schema.prisma" ]; }

if is_booking_repo "$ROOT"; then
  log "already inside the repo: $ROOT"
elif is_booking_repo "$CLONE_DIR"; then
  ROOT="$CLONE_DIR"; log "using existing checkout: $ROOT"
else
  if [ -e "$CLONE_DIR" ] && [ -n "$(ls -A "$CLONE_DIR" 2>/dev/null)" ]; then
    err "$CLONE_DIR exists and is not a booking checkout. Move it aside, or pass --dir PATH."
  fi
  info "cloning $REPO_URL -> $CLONE_DIR"
  mkdir -p "$(dirname "$CLONE_DIR")"
  CLONED=0
  case "$REPO_URL" in
    https://github.com/*)
      if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
        gh repo clone "${REPO_URL#https://github.com/}" "$CLONE_DIR" && CLONED=1 \
          || warn "gh repo clone failed — falling back to git"
      fi ;;
  esac
  [ "$CLONED" -eq 1 ] || git clone "$REPO_URL" "$CLONE_DIR" \
    || err "clone failed — check your network, or 'gh auth login' if the repo is now private."
  is_booking_repo "$CLONE_DIR" || err "clone finished but $CLONE_DIR is not the booking repo"
  ROOT="$CLONE_DIR"; log "cloned to $ROOT"
fi

case "$ROOT" in
  /mnt/*) warn "repo is on a Windows mount ($ROOT) — npm installs are slow there and"
          warn "  rollup/esbuild can pick up the wrong platform binary. Prefer ~/ ." ;;
  *)      log "on the Linux filesystem" ;;
esac

# The canonical copy lives in the repo; a copy in ~/ is what bootstraps a
# machine with no checkout yet. Flag drift rather than letting the ~/ one rot.
SELF_PATH="${SELF_SRC:+$(cd "$(dirname "$SELF_SRC")" && pwd)/$(basename "$SELF_SRC")}"
REPO_COPY="$ROOT/setup-booking.sh"
if [ -n "$SELF_PATH" ] && [ "$SELF_PATH" != "$REPO_COPY" ] && [ -f "$REPO_COPY" ] && ! cmp -s "$SELF_PATH" "$REPO_COPY"; then
  warn "the repo's setup-booking.sh differs from the copy you ran"
  warn "  running: $SELF_PATH"
  warn "  repo:    $REPO_COPY"
  warn "  refresh with:  cp '$REPO_COPY' '$SELF_PATH'"
fi

# ── Git identity + SSH ───────────────────────────────────────────────────────
if [ "$DO_GIT" = 1 ]; then
  step "Git identity & SSH"
  # The `|| true` is load-bearing: on a checkout with no origin remote this
  # pipeline exits non-zero, and under `set -o pipefail` that failure propagates
  # out of the command substitution to the ASSIGNMENT, which `set -e` then turns
  # into a silent exit mid-script.
  GIT_NAME="${GIT_NAME:-$(git -C "$ROOT" config --get remote.origin.url 2>/dev/null | sed -nE 's#.*github\.com[:/]([^/]+)/.*#\1#p' || true)}"
  GIT_EMAIL="${GIT_EMAIL:-}"

  git config --get user.name >/dev/null 2>&1 && log "user.name  $(git config --get user.name)" || {
    [ -n "$GIT_NAME" ] && { git config --global user.name "$GIT_NAME"; log "user.name  set to '$GIT_NAME'"; } \
                       || warn "user.name unset — git config --global user.name 'Your Name'"; }

  if [ -z "$GIT_EMAIL" ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    GIT_EMAIL="$(gh api user --jq '.email // empty' 2>/dev/null || true)"
  fi
  if git config --get user.email >/dev/null 2>&1; then
    log "user.email $(git config --get user.email)"
  elif [ -n "$GIT_EMAIL" ]; then
    git config --global user.email "$GIT_EMAIL"; log "user.email set to '$GIT_EMAIL'"
  elif [ "$INTERACTIVE" = 1 ]; then
    read -r -p "  Git commit email: " _e < /dev/tty
    [ -n "$_e" ] && { git config --global user.email "$_e"; log "user.email set to '$_e'"; } \
                 || warn "left unset — 'git commit' will fail until you set it"
  fi
  git config --global --get init.defaultBranch >/dev/null 2>&1 || git config --global init.defaultBranch main

  SSH_KEY="$HOME/.ssh/id_ed25519"
  if [ -f "$SSH_KEY" ]; then
    log "reusing existing key: $SSH_KEY"
  else
    mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
    ssh-keygen -t ed25519 -C "$(git config --get user.email || echo "dev@$(hostname)")" \
               -f "$SSH_KEY" -N "${SSH_PASSPHRASE:-}" -q
    chmod 600 "$SSH_KEY"; log "created $SSH_KEY"
  fi
  touch "$HOME/.ssh/known_hosts"; chmod 600 "$HOME/.ssh/known_hosts"
  ssh-keygen -F github.com >/dev/null 2>&1 || {
    ssh-keyscan -t rsa,ecdsa,ed25519 github.com >>"$HOME/.ssh/known_hosts" 2>/dev/null
    log "github.com pinned in known_hosts"; }

  # Move origin to SSH now that a key exists (the clone above used HTTPS/gh).
  ORIGIN="$(git -C "$ROOT" remote get-url origin 2>/dev/null || echo '')"
  case "$ORIGIN" in
    git@github.com:*) log "origin already SSH" ;;
    https://github.com/*)
      SLUG="${ORIGIN#https://github.com/}"; SLUG="${SLUG%.git}"
      git -C "$ROOT" remote set-url origin "git@github.com:${SLUG}.git"
      log "origin -> git@github.com:${SLUG}.git" ;;
  esac

  # `ssh -T` exits 1 by design; capture instead of piping, or pipefail reports
  # a working key as broken.
  # -n is load-bearing under `curl … | bash`: there, the script's own source text
  # IS stdin, and ssh drains stdin to forward it to the remote. Without -n it
  # swallows the whole rest of this file, bash then reads EOF and exits 0 —
  # silently skipping Node, npm ci, .env.local and the summary, with no error.
  SSH_OUT="$(ssh -n -o BatchMode=yes -o StrictHostKeyChecking=yes -T git@github.com 2>&1 || true)"
  if [ "${SSH_OUT#*successfully authenticated}" != "$SSH_OUT" ]; then
    log "SSH key accepted by GitHub"
  else
    if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
      gh ssh-key add "${SSH_KEY}.pub" --title "booking-dev-$(hostname)" >/dev/null 2>&1 \
        && log "SSH key uploaded to your GitHub account" || true
    fi
    SSH_OUT="$(ssh -n -o BatchMode=yes -T git@github.com 2>&1 || true)"
    if [ "${SSH_OUT#*successfully authenticated}" = "$SSH_OUT" ]; then
      echo ""
      echo -e "${B}Add this key at https://github.com/settings/ssh/new${N}"
      echo -e "${G}$(cat "${SSH_KEY}.pub")${N}"
      echo ""
    fi
  fi
fi

# ── Node.js ──────────────────────────────────────────────────────────────────
if [ "$DO_NODE" = 1 ]; then
  step "Node.js 22 LTS"
  # The real constraint is the INTERSECTION of two engine ranges:
  #   next 16.3      >=20.9.0
  #   prisma 7.9     ^20.19 || ^22.12 || >=24.0
  # so 21.x, 23.x and 22.0-22.11 are all unusable. Check properly instead of
  # waving through anything >= 20.
  node_ok() {
    command -v node >/dev/null 2>&1 || return 1
    local v maj min; v="$(node -v)"; v="${v#v}"
    maj="${v%%.*}"; min="${v#*.}"; min="${min%%.*}"
    case "$maj" in
      20) [ "$min" -ge 19 ] ;;
      22) [ "$min" -ge 12 ] ;;
      24|25|26|27|28) : ;;
      *)  return 1 ;;
    esac
  }
  if node_ok; then
    log "node $(node -v) satisfies next (>=20.9) and prisma (^20.19 || ^22.12 || >=24)"
  else
    command -v node >/dev/null 2>&1 \
      && warn "node $(node -v) does not satisfy prisma's engine range — installing 22 LTS" \
      || info "installing Node 22 LTS from NodeSource"
    # 'nodistro' is codename-independent — important on newer releases where
    # NodeSource publishes no per-codename dist.
    $SUDO mkdir -p -m 755 /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | $SUDO gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    $SUDO chmod go+r /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      | $SUDO tee /etc/apt/sources.list.d/nodesource.list >/dev/null
    apt_update
    apt_install nodejs
  fi
  log "node $(node -v) | npm $(npm -v)"
fi

# ── Dependencies ─────────────────────────────────────────────────────────────
if [ "$DO_INSTALL" = 1 ]; then
  step "Dependencies"
  if [ -d "$ROOT/node_modules" ]; then
    log "node_modules present — skipping (rm -rf it to force a clean install)"
  else
    # npm ci, not install: package-lock.json is committed. postinstall runs
    # `prisma generate`, which writes the client into src/generated/prisma.
    info "npm ci (this also runs 'prisma generate' via postinstall)"
    # A failure here must NOT abort the run. npm ci is the one step that depends
    # on a slow public registry, and on a flaky connection it times out; killing
    # the script at that point would skip .env.local scaffolding and the summary
    # entirely, leaving a half-configured checkout and no report of what is left.
    # The summary below re-checks node_modules and prints the exact retry command.
    ( cd "$ROOT" && NPM_CONFIG_UPDATE_NOTIFIER=false npm ci --no-fund --no-audit --loglevel=error ) \
      || warn "npm ci failed (see above) — continuing; retry with: cd $ROOT && npm ci"
  fi
  # Generated Prisma client lives in src/generated/prisma (see schema.prisma's
  # generator block), not node_modules/.prisma, so check the real path.
  [ -d "$ROOT/src/generated/prisma" ] && log "prisma client generated" \
    || warn "prisma client missing — run: cd $ROOT && npx prisma generate"
fi

# ── .env.local ───────────────────────────────────────────────────────────────
if [ "$DO_ENV" = 1 ]; then
  step ".env.local"
  ENVF="$ROOT/.env.local"
  if [ -f "$ENVF" ]; then
    log ".env.local exists — left untouched"
    chmod 600 "$ENVF" 2>/dev/null || true
  else
    # .gitignore is '.env*' with a '!.env.example' negation, so .env.local can
    # never be committed. Verified rather than assumed — it holds a live DB URL.
    if ! git -C "$ROOT" check-ignore -q "$ENVF" 2>/dev/null; then
      err "REFUSING to write .env.local — it is not gitignored."
    fi
    # Copied from the committed template rather than a heredoc here, so the
    # variable list has ONE source of truth that a fresh clone can also read.
    [ -f "$ROOT/.env.example" ] || err "missing $ROOT/.env.example — cannot scaffold .env.local"
    cp "$ROOT/.env.example" "$ENVF"
    chmod 600 "$ENVF"
    set_env_var "$ENVF" NEXTAUTH_SECRET "$(openssl rand -base64 32)"
    log "created .env.local from .env.example (mode 600), NEXTAUTH_SECRET generated"
  fi

  # ── DATABASE_URL ───────────────────────────────────────────────────────────
  # Nothing in this project works without it: next dev, prisma migrate, prisma
  # studio and the backup scripts all fail immediately. So prompt rather than
  # leaving the user to find out at first run.
  DBU="$(sed -nE 's/^DATABASE_URL=(.*)$/\1/p' "$ENVF" | head -1 || true)"
  if [ -n "$DBU" ]; then
    log "DATABASE_URL already set"
  elif [ "$INTERACTIVE" = 1 ]; then
    echo ""
    echo -e "  ${B}DATABASE_URL is required — the app is backed by Neon PostgreSQL.${N}"
    echo ""
    echo -e "  ${B}Where to get it${N}"
    echo -e "    1. Neon console   ${C}https://console.neon.tech${N}"
    echo "         pick your project -> Connect -> copy the connection string"
    echo -e "    2. Or from Vercel ${C}https://vercel.com/dashboard${N}"
    echo "         project -> Settings -> Environment Variables -> DATABASE_URL"
    echo "         (or run:  vercel link && vercel env pull .env.local)"
    echo ""
    echo -e "  ${B}Pick the DIRECT connection, not the pooled one${N}"
    echo "    In Neon's Connect dialog, turn OFF \"Connection pooling\" — the"
    echo "    direct host has NO '-pooler' in it. src/lib/prisma.ts already runs"
    echo "    its own pg Pool, and prisma migrate / pg_dump need a direct link."
    echo ""
    echo "    It looks like:"
    echo -e "      ${C}postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/DB?sslmode=require${N}"
    echo ""
    echo "  Press Enter to skip and fill it in later."
    while :; do
      read -r -p "  DATABASE_URL: " DBU < /dev/tty
      [ -z "$DBU" ] && { warn "skipped — set DATABASE_URL in .env.local before running the app"; break; }
      # Validate shape before writing: a wrong URL here surfaces later as an
      # opaque connection error, which is far harder to trace back to this step.
      case "$DBU" in
        postgres://*|postgresql://*) ;;
        *) warn "  must start with postgresql:// (or postgres://) — try again"; continue ;;
      esac
      case "$DBU" in
        *-pooler.*)
          warn "  that is Neon's POOLED host (-pooler)."
          warn "  prisma migrate and pg_dump need the direct one."
          read -r -p "  Use it anyway? [y/N] " _yn < /dev/tty
          case "$_yn" in [Yy]*) ;; *) continue ;; esac ;;
      esac
      set_env_var "$ENVF" DATABASE_URL "$DBU"
      log "DATABASE_URL written to .env.local"
      # Prove it actually connects, now, while the context is still on screen.
      # Only when prisma is actually installed: with no node_modules (npm ci
      # skipped or failed) `npx` would try to FETCH prisma from the registry,
      # which on the slow path hangs for minutes on what is only a nicety.
      if [ ! -d "$ROOT/node_modules" ]; then
        warn "skipping the connection test — dependencies are not installed yet"
        break
      fi
      info "testing the connection..."
      # Capture once and branch on what Prisma actually said. The previous
      # version ran the command twice and treated ANY non-zero exit as "could
      # not reach the database" — which misdiagnosed every non-network failure
      # (a bad datasource config reads identically to an unroutable host) and
      # sent you looking at the URL you had just correctly pasted.
      CONN_OUT="$(cd "$ROOT" && npx prisma migrate status 2>&1 || true)"
      case "$CONN_OUT" in
        *"Database schema is up to date"*)
          log "connected — database reachable and migrations up to date" ;;
        *"not yet been applied"*|*"pending"*)
          warn "connected, but migrations are pending — run: npx prisma migrate deploy" ;;
        *)
          warn "could not verify the database. Prisma reported:"
          printf '%s\n' "$CONN_OUT" | grep -v '^$' | tail -4 | sed 's/^/        /' >&2
          warn "the URL is saved in .env.local either way — fix and re-check with:"
          warn "  cd $ROOT && npx prisma migrate status" ;;
      esac
      break
    done
  else
    warn "DATABASE_URL is empty (non-interactive run) — set it in .env.local"
  fi
fi

# ── Optional: Vercel CLI ─────────────────────────────────────────────────────
if [ "$W_VERCEL" = 1 ]; then
  step "Vercel CLI"
  if command -v vercel >/dev/null 2>&1; then
    log "vercel present: $(vercel --version 2>/dev/null | head -1)"
  else
    # -g into the user prefix, so no sudo and nothing root-owned in npm's tree.
    npm config get prefix | grep -q "^$HOME" || npm config set prefix "$HOME/.local"
    npm install -g vercel --loglevel=error >/dev/null 2>&1 \
      && log "vercel installed" || warn "vercel install failed (optional)"
  fi
  info "link the project with:  cd $ROOT && vercel link"
  info "then pull real env vars: vercel env pull .env.local"
fi

# ── Optional: PostgreSQL 17 client ───────────────────────────────────────────
if [ "$W_PGCLIENT" = 1 ]; then
  step "PostgreSQL 17 client"
  if command -v pg_dump >/dev/null 2>&1 && pg_dump --version | grep -q " 17"; then
    log "pg_dump 17 present"
  else
    # PostgreSQL's own repo script, not hand-rolled apt lines: distro packages
    # lag behind Neon's server version, and pg_dump refuses to dump a server
    # newer than itself. .github/workflows/backup.yml hit exactly this.
    info "adding the PostgreSQL apt repo and installing client 17"
    apt_install postgresql-common
    $SUDO /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >>"$APT_LOG" 2>&1 \
      || warn "pgdg repo script failed"
    apt_update
    apt_install postgresql-client-17
    [ -x /usr/lib/postgresql/17/bin/pg_dump ] \
      && log "pg_dump $( /usr/lib/postgresql/17/bin/pg_dump --version | awk '{print $3}')" \
      || warn "postgresql-client-17 not found after install"
  fi
fi

# ── Optional verification ────────────────────────────────────────────────────
if [ "$VERIFY" = 1 ]; then
  step "Verify"
  info "next build (proves the app compiles)"
  ( cd "$ROOT" && npx next build ) && log "build succeeded" || warn "build failed — see output above"
fi

# ── Final report ─────────────────────────────────────────────────────────────
# Re-checks live state rather than replaying earlier messages, so anything
# resolved during the run (or already true) simply does not appear.
step "Summary"
TODO=()
ok()   { printf "  ${G}✓${N} %-14s %s\n" "$1" "$2"; }
miss() { printf "  ${Y}!${N} %-14s %s\n" "$1" "$2"; }

command -v git  >/dev/null 2>&1 && ok "git"    "$(git --version | awk '{print $3}')"
if command -v node >/dev/null 2>&1; then ok "node" "$(node -v) / npm $(npm -v)"
else miss "node" "not installed"; TODO+=("Node did not install — re-run the script"); fi
command -v gh     >/dev/null 2>&1 && ok "gh"     "$(gh --version | head -1 | awk '{print $3}')"
command -v vercel >/dev/null 2>&1 && ok "vercel" "$(vercel --version 2>/dev/null | head -1)"
command -v pg_dump >/dev/null 2>&1 && ok "pg_dump" "$(pg_dump --version | awk '{print $3}')"

echo ""
GN="$(git config --get user.name || true)"; GE="$(git config --get user.email || true)"
[ -n "$GN" ] && [ -n "$GE" ] && ok "git identity" "$GN <$GE>" \
  || { miss "git identity" "incomplete"; TODO+=("git config --global user.email 'you@example.com'"); }

SSH_PROBE="$(ssh -n -o BatchMode=yes -o StrictHostKeyChecking=yes -T git@github.com 2>&1 || true)"
[ "${SSH_PROBE#*successfully authenticated}" != "$SSH_PROBE" ] && ok "github ssh" "key accepted" \
  || { miss "github ssh" "key not accepted"; TODO+=("Add ~/.ssh/id_ed25519.pub at https://github.com/settings/ssh/new"); }

if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 && ok "gh auth" "authenticated" \
    || { miss "gh auth" "not authenticated"; TODO+=("Run 'gh auth login' to upload your SSH key and enable 'git push'"); }
fi

echo ""
ok "repo" "$ROOT"
[ -d "$ROOT/node_modules" ] && ok "deps" "installed" \
  || { miss "deps" "node_modules missing"; TODO+=("cd $ROOT && npm ci"); }
[ -d "$ROOT/src/generated/prisma" ] && ok "prisma client" "generated" \
  || { miss "prisma client" "not generated"; TODO+=("cd $ROOT && npx prisma generate"); }

if [ -f "$ROOT/.env.local" ]; then
  DBU="$(sed -nE 's/^DATABASE_URL=(.*)$/\1/p' "$ROOT/.env.local" | head -1 || true)"
  NAS="$(sed -nE 's/^NEXTAUTH_SECRET=(.*)$/\1/p' "$ROOT/.env.local" | head -1 || true)"
  [ -n "$NAS" ] && ok ".env.local" "present, NEXTAUTH_SECRET set" || miss ".env.local" "NEXTAUTH_SECRET empty"
  if [ -z "$DBU" ]; then
    miss "DATABASE_URL" "empty"
    TODO+=("Set DATABASE_URL in .env.local (Neon console, or 'vercel env pull .env.local') — the app and prisma cannot start without it")
  else
    ok "DATABASE_URL" "set"
    # Only meaningful once a URL exists; reports drift without applying anything.
    # Gated on node_modules for the same reason as the connection test above:
    # bare `npx prisma` with no local install goes to the network.
    if [ ! -d "$ROOT/node_modules" ]; then
      miss "migrations" "not checked (dependencies missing)"
    elif MIG="$(cd "$ROOT" && npx prisma migrate status 2>&1)"; then
      ok "migrations" "database up to date"
    else
      case "$MIG" in
        *"not yet been applied"*|*"pending"*)
          miss "migrations" "pending"
          TODO+=("cd $ROOT && npx prisma migrate deploy   # apply pending migrations") ;;
        # Must add a TODO: without one the run ends on "your dev environment is
        # ready" while the database is demonstrably not queryable.
        *) miss "migrations" "could not check"
           TODO+=("Database not queryable: cd $ROOT && npx prisma migrate status   # shows the real error") ;;
      esac
    fi
  fi
else
  miss ".env.local" "missing"; TODO+=("Re-run without --no-env to scaffold .env.local")
fi

echo ""
if [ ${#TODO[@]} -eq 0 ]; then
  echo -e "${G}${B}✓ Setup complete — your dev environment is ready.${N}"
else
  echo -e "${Y}${B}✓ Setup complete — ${#TODO[@]} item(s) still need you:${N}"
  i=1; for t in "${TODO[@]}"; do echo -e "  ${Y}$i.${N} $t"; i=$((i+1)); done
fi

echo ""
echo -e "${B}Start working${N}"
echo "  cd $ROOT"
echo "  npm run dev            # http://localhost:3000"
echo "  npx prisma studio      # browse the database"
echo "  npm run lint"
rm -f "$APT_LOG" 2>/dev/null || true
