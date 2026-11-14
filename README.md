# StreamBot

Centro de control para directos faceless: une el chat de Twitch, YouTube y TikTok, y un co-host IA con voz propia lee el chat y responde en tiempo real mientras juegas en silencio.

```
Twitch ─┐
YouTube ├─> chat unificado ─> filtro ─> Claude (personaje) ─> ElevenLabs (voz)
TikTok ─┘        │                                                 │
                 ▼                                                 ▼
          Panel de control                    Overlay en OBS: chat + subtítulos + audio
                                                              │
                                              OBS ─> Twitch / YouTube / TikTok
```

OBS captura la consola y emite. StreamBot pone el chat, el personaje y la voz, que llegan a OBS como una fuente de navegador.

## Probar en dos minutos (sin claves)

```bash
npm install
```

```bash
npm run demo
```

Abre `http://127.0.0.1:4747/panel/` para el panel y `http://127.0.0.1:4747/overlay/` para ver el overlay. El modo demo usa chat simulado y respuestas de ejemplo, sin voz.

## Uso real

```bash
npm start
```

En el panel:

1. **Claves**: pega la de Anthropic (cerebro) y la de ElevenLabs (voz). Para YouTube, una clave de YouTube Data API v3.
2. **Personaje y voz**: nombre del personaje, juego e ID de la voz de ElevenLabs.
3. **Plataformas**: canal de Twitch (no necesita clave), enlace del directo de YouTube, usuario de TikTok.
4. **OBS**: copia la dirección del overlay y añádela en OBS como fuente de navegador.

La guía completa de consola, capturadora, OBS y multistream está en [docs/montaje.md](docs/montaje.md).

Las claves y ajustes se guardan en `~/Library/Application Support/StreamBot/config.json` (solo lectura para tu usuario), fuera del repositorio. También se pueden pasar por variables de entorno; ver `.env.example`.

## App de escritorio para macOS

```bash
npm run app
```

Abre el panel en su propia ventana. Para generar el instalador `.dmg` (hay que hacerlo en un Mac):

```bash
npm run dist
```

## Controles durante el directo

- **Pausar / Reanudar**: el personaje deja de responder al chat.
- **Saltar**: corta lo que esté diciendo.
- **Que el personaje diga**: escribes una frase y la dice tal cual, también en pausa.
- **Chat simulado**: mensajes de mentira para ensayar.

## El personaje

Su personalidad, forma de hablar y límites están en [persona/personaje.md](persona/personaje.md). Edítalo a tu gusto; `{{NOMBRE}}` y `{{JUEGO}}` se rellenan con los ajustes del panel.

## Desarrollo

```bash
npm test
```

| Carpeta | Contenido |
|---|---|
| `src/connectors/` | Chat de Twitch (IRC anónimo), YouTube (API oficial), TikTok (librería no oficial) y simulador |
| `src/chat/` | Filtro y selector de mensajes |
| `src/agent/` | Personaje (Claude), troceado por frases y orquestación |
| `src/voice/` | Voz por streaming con ElevenLabs |
| `src/server.ts`, `src/app.ts` | Servidor local (solo 127.0.0.1) y unión de todo |
| `public/` | Panel de control y overlay para OBS |
| `electron/` | Ventana de escritorio |

## Límites conocidos

- **YouTube**: cada consulta al chat gasta cuota de la API. Con la cuota gratuita y el intervalo por defecto (6 s) alcanza para unas 3,3 h de directo al día; el panel lo calcula al cambiar el intervalo.
- **TikTok**: no hay API oficial de chat. El conector puede dejar de funcionar si TikTok cambia algo; el resto de la app no se ve afectado.
- **Emitir en TikTok desde ordenador** requiere que TikTok te dé clave de stream (normalmente a partir de ~1.000 seguidores).
