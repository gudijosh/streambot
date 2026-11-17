#!/bin/bash
# Instalador de StreamBot para macOS (Apple Silicon).
#
# Instala lo que hace falta (Homebrew, Node 22, git y ffmpeg), descarga StreamBot
# en ~/streambot y crea la app «StreamBot» en Aplicaciones para abrirlo con un clic.
# Volver a ejecutarlo actualiza StreamBot a la última versión.
#
# Uso, en Terminal:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/gudijosh/streambot/HEAD/scripts/instalar-mac.sh)"

set -euo pipefail

REPO_URL="https://github.com/gudijosh/streambot.git"
DIR="${STREAMBOT_DIR:-$HOME/streambot}"

paso() { printf '\n\033[1;33m==> %s\033[0m\n' "$1"; }
fallo() { printf '\n\033[1;31m%s\033[0m\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fallo "Este instalador es solo para macOS."
if [ "$(uname -m)" != "arm64" ]; then
  echo "Aviso: este Mac no es Apple Silicon. StreamBot funcionará, pero la voz local no."
fi

# 1. Homebrew
if ! command -v brew >/dev/null 2>&1; then
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  else
    paso "Instalando Homebrew. Te pedirá la contraseña del Mac (no se ve al escribirla)."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
fi
if ! grep -qs 'brew shellenv' "$HOME/.zprofile"; then
  echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
fi

# 2. Node 22, git y ffmpeg (ffmpeg sirve para exportar y narrar clips)
paso "Instalando Node 22, git y ffmpeg"
for pkg in node@22 git ffmpeg; do
  if brew list --versions "$pkg" >/dev/null 2>&1; then
    echo "$pkg ya está instalado."
  else
    brew install "$pkg"
  fi
done
NODE_BIN="$(brew --prefix node@22)/bin"
export PATH="$NODE_BIN:$PATH"

# 3. StreamBot
if [ -d "$DIR/.git" ]; then
  paso "Actualizando StreamBot en $DIR"
  git -C "$DIR" pull --ff-only || fallo "No pude actualizar: hay cambios hechos a mano en $DIR. Guárdalos aparte y vuelve a ejecutar el instalador."
else
  [ -e "$DIR" ] && fallo "Ya existe $DIR y no es una copia de StreamBot. Muévela o bórrala y vuelve a ejecutar el instalador."
  paso "Descargando StreamBot en $DIR"
  git clone "$REPO_URL" "$DIR"
fi

paso "Instalando las dependencias de StreamBot (tarda un par de minutos)"
cd "$DIR"
npm install --no-fund --no-audit
npm run build
chmod +x "$DIR/scripts/abrir-streambot.sh"

# 4. La app «StreamBot» para abrirlo con doble clic
APPS="/Applications"
[ -w "$APPS" ] || APPS="$HOME/Applications"
mkdir -p "$APPS"
APP="$APPS/StreamBot.app"
paso "Creando $APP"
rm -rf "$APP"
LAUNCHER="$DIR/scripts/abrir-streambot.sh"
osacompile -o "$APP" -e "do shell script quoted form of \"$LAUNCHER\" & \" > /dev/null 2>&1 &\""

paso "¡Listo!"
cat <<EOF

StreamBot está instalado en: $DIR
Para abrirlo: busca «StreamBot» en Aplicaciones o en Spotlight (Cmd + espacio).
Arrástralo al Dock para tenerlo a mano.

La primera vez tarda unos segundos en abrir la ventana.
Si no se abre, mira el registro: $HOME/Library/Logs/StreamBot.log

Para actualizar StreamBot, vuelve a pegar el mismo comando de instalación.
EOF

open -R "$APP" || true
