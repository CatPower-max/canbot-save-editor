#!/bin/sh
# CanBot local editor installer (Termux, Linux, macOS):
#   curl -fsSL https://canbot.dev/local/install.sh | sh
# Puts canbot.js in ~/.canbot and a "canbot" command in $PREFIX/bin (Termux) or ~/bin. The command refreshes
# canbot.js from canbot.dev at most every 6 hours and keeps using the copy it has when offline.
# CANBOT_DOWNLOAD=<url> installs from another address (a self-hosted copy); the command keeps using it.
# SPDX-License-Identifier: AGPL-3.0-or-later  Copyright (C) 2026 CanBot
set -e
URL="${CANBOT_DOWNLOAD:-https://canbot.dev/local/canbot.js}"
DIR="$HOME/.canbot"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 필요합니다 / Node.js is needed."
  echo "  Termux: pkg install nodejs"
  echo "  PC: https://nodejs.org (18+)"
  exit 1
fi
command -v curl >/dev/null 2>&1 || { echo "curl이 필요합니다 / curl is needed (Termux: pkg install curl)"; exit 1; }

mkdir -p "$DIR"
curl -fsSL "$URL" -o "$DIR/canbot.js.new"
mv "$DIR/canbot.js.new" "$DIR/canbot.js"

if [ -n "$PREFIX" ] && [ -d "$PREFIX/bin" ] && [ -w "$PREFIX/bin" ]; then BIN="$PREFIX/bin"; else BIN="$HOME/bin"; mkdir -p "$BIN"; fi
echo "$URL" > "$DIR/download-url"
cat > "$BIN/canbot" <<'LAUNCHER'
#!/bin/sh
# canbot: runs the CanBot local editor, refreshing it at most every 6 hours from the address it was installed from.
DIR="$HOME/.canbot"; JS="$DIR/canbot.js"
URL="$(cat "$DIR/download-url" 2>/dev/null)"; [ -n "$URL" ] || URL=https://canbot.dev/local/canbot.js
if [ ! -s "$JS" ] || [ -n "$(find "$JS" -mmin +360 2>/dev/null)" ]; then
  if curl -fsSL --max-time 30 "$URL" -o "$JS.new" 2>/dev/null && [ -s "$JS.new" ]; then mv "$JS.new" "$JS"; else rm -f "$JS.new"; fi
fi
[ -s "$JS" ] || { echo "canbot.js를 받지 못했습니다 / could not download canbot.js"; exit 1; }
exec node "$JS" "$@"
LAUNCHER
chmod +x "$BIN/canbot"

echo ""
echo "설치 완료 / Installed: $BIN/canbot"
case ":$PATH:" in
  *":$BIN:"*) echo "이제 canbot 만 입력하면 됩니다 / Run: canbot" ;;
  *) echo "PATH에 $BIN 을 추가하세요 / Add $BIN to PATH:"
     echo "  echo 'export PATH=\"\$HOME/bin:\$PATH\"' >> ~/.profile && . ~/.profile"
     echo "그 다음 canbot 입력 / then run: canbot" ;;
esac
