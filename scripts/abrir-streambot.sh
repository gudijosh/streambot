#!/bin/bash
# Abre StreamBot en su ventana de escritorio. Lo usa la app «StreamBot» que crea
# scripts/instalar-mac.sh; también se puede ejecutar a mano.

DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Las apps del Finder no cargan el PATH de Terminal: añadimos Node 22 y Homebrew.
for p in /usr/local/bin /opt/homebrew/bin /usr/local/opt/node@22/bin /opt/homebrew/opt/node@22/bin; do
  [ -d "$p" ] && PATH="$p:$PATH"
done
export PATH

LOG="$HOME/Library/Logs/StreamBot.log"
mkdir -p "$(dirname "$LOG")"
{
  echo
  echo "=== $(date) ==="
} >> "$LOG"

cd "$DIR" || exit 1
exec npm run app >> "$LOG" 2>&1
