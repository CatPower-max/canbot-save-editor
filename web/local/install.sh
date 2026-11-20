#!/bin/sh
# CanBot local editor installer (Termux, Linux, macOS):
#   curl -fsSL https://canbot.dev/local/install.sh | sh
# Puts canbot.js in ~/.canbot and a "canbot" command in $PREFIX/bin (Termux) or ~/bin. The command refreshes
# canbot.js from canbot.dev at most every 6 hours and keeps using the copy it has when offline.
# CANBOT_DOWNLOAD=<url> installs from another address (a self-hosted copy); the command keeps using it.
# Both check that Node.js starts and is 18 or newer, and print how to fix it when it is not (on Termux, the usual
# cause is a nodejs package left behind by a library update, e.g. "CANNOT LINK EXECUTABLE ... libicu").
# SPDX-License-Identifier: AGPL-3.0-or-later  Copyright (C) 2026 CanBot
set -e
URL="${CANBOT_DOWNLOAD:-https://canbot.dev/local/canbot.js}"
DIR="$HOME/.canbot"

NODE_CHECK='
is_termux() { [ -n "$TERMUX_VERSION" ] && return 0; case "$PREFIX" in *com.termux*) return 0;; esac; return 1; }
node_ok() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js가 없습니다 / Node.js is not installed."
    if is_termux; then echo "  pkg install nodejs"; else echo "  https://nodejs.org (18+)"; fi
    return 1
  fi
  if OUT="$(node -e "process.stdout.write(process.versions.node)" 2>&1)"; then
    MAJOR="${OUT%%.*}"
    if [ "$MAJOR" -ge 18 ] 2>/dev/null; then return 0; fi
    echo "Node.js $OUT 은(는) 너무 오래됐습니다 / Node.js $OUT is too old (18+ needed)."
    if is_termux; then echo "  pkg update && pkg upgrade -y"; else echo "  https://nodejs.org"; fi
    return 1
  fi
  echo "Node.js가 실행되지 않습니다 / Node.js does not start:"
  printf "%s\n" "$OUT" | head -n 3 | sed "s/^/    /"
  if is_termux; then
    echo "고치는 방법 (Termux) / How to fix (Termux):"
    echo "  1) pkg update && pkg upgrade -y"
    case "$OUT" in
      *"CANNOT LINK"*|*libicu*|*"library"*)
        echo "  2) pkg reinstall nodejs libicu"
        echo "     (nodejs-lts 를 쓰는 경우 / with nodejs-lts: pkg reinstall nodejs-lts libicu)" ;;
    esac
    echo "  그래도 안 되면 / if it still fails: pkg uninstall nodejs-lts; pkg install nodejs"
    echo "  확인 / check: node -v"
  else
    echo "Node.js를 다시 설치하세요 / Reinstall Node.js: https://nodejs.org"
  fi
  return 1
}
'
eval "$NODE_CHECK"
node_ok || exit 1
command -v curl >/dev/null 2>&1 || { echo "curl이 필요합니다 / curl is needed (Termux: pkg install curl)"; exit 1; }

mkdir -p "$DIR"
curl -fsSL "$URL" -o "$DIR/canbot.js.new"
mv "$DIR/canbot.js.new" "$DIR/canbot.js"

if [ -n "$PREFIX" ] && [ -d "$PREFIX/bin" ] && [ -w "$PREFIX/bin" ]; then BIN="$PREFIX/bin"; else BIN="$HOME/bin"; mkdir -p "$BIN"; fi
echo "$URL" > "$DIR/download-url"
{
  echo '#!/bin/sh'
  echo '# canbot: runs the CanBot local editor, refreshing it at most every 6 hours from the address it was installed from.'
  printf '%s\n' "$NODE_CHECK"
  cat <<'LAUNCHER'
node_ok || exit 1
DIR="$HOME/.canbot"; JS="$DIR/canbot.js"
URL="$(cat "$DIR/download-url" 2>/dev/null)"; [ -n "$URL" ] || URL=https://canbot.dev/local/canbot.js
if [ ! -s "$JS" ] || [ -n "$(find "$JS" -mmin +360 2>/dev/null)" ]; then
  if curl -fsSL --max-time 30 "$URL" -o "$JS.new" 2>/dev/null && [ -s "$JS.new" ]; then mv "$JS.new" "$JS"; else rm -f "$JS.new"; fi
fi
[ -s "$JS" ] || { echo "canbot.js를 받지 못했습니다 / could not download canbot.js"; exit 1; }
exec node "$JS" "$@"
LAUNCHER
} > "$BIN/canbot"
chmod +x "$BIN/canbot"

echo ""
echo "설치 완료 / Installed: $BIN/canbot"
case ":$PATH:" in
  *":$BIN:"*) echo "이제 canbot 만 입력하면 됩니다 / Run: canbot" ;;
  *) echo "PATH에 $BIN 을 추가하세요 / Add $BIN to PATH:"
     echo "  echo 'export PATH=\"\$HOME/bin:\$PATH\"' >> ~/.profile && . ~/.profile"
     echo "그 다음 canbot 입력 / then run: canbot" ;;
esac
