# StreamBot

Estudio todo en uno para directos faceless: une el chat de Twitch, YouTube y TikTok, un co-host IA con voz propia responde al chat mientras juegas en silencio, guarda y recorta clips para redes, y aplica las artes de tu marca al directo.

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

En la pestaña Ajustes del panel:

1. **Claves**: pega la de Anthropic (cerebro) y la de ElevenLabs (voz). Para YouTube, una clave de YouTube Data API v3.
2. **Co-host y voz**: juego e ID de la voz de ElevenLabs. El nombre del personaje está en la pestaña Marca.
3. **Plataformas**: canal de Twitch (no necesita clave), enlace del directo de YouTube, usuario de TikTok.
4. **OBS**: en la pestaña Marca, copia la dirección del overlay y añádela en OBS como fuente de navegador.

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

## Pestañas del panel

### Directo

- **Guardar clip**: guarda los últimos segundos de la partida (necesita el búfer de repetición de OBS).
- **OBS**: emitir, grabar, búfer de repetición y cambio de escena sin salir del panel.
- **Co-host**: pausar, saltar lo que está diciendo, o escribir una frase para que la diga tal cual.
- **Este directo**: mensajes, personas en el chat, eventos, intervenciones y créditos de voz gastados.
- **Chat simulado**: mensajes de mentira para ensayar.

### Jugar solo

Un interruptor en la pestaña Directo: sin directo ni chat, el personaje mira la partida cada pocos segundos y la narra. Su voz queda grabada en OBS junto al juego, así que los clips salen ya narrados. Ver [docs/jugar-solo.md](docs/jugar-solo.md).

### Clips

- **Momentos**: se marcan con el botón, con `!clip` en el chat o solos cuando el chat se dispara.
- **Vídeos**: clips guardados, grabaciones de OBS y cualquier vídeo que añadas por su ruta.
- **Editor**: marca inicio y fin, elige formato (vertical 9:16 con fondo difuminado, vertical recortado u horizontal), añade tu logo como marca de agua y exporta.
- **Narrar con el personaje**: la IA mira el tramo marcado, escribe la narración y la monta con la voz del personaje sobre el juego, con subtítulos. Crea un vídeo nuevo.
- **Texto para publicar**: la IA propone título, descripción y hashtags a partir de lo que pasó en el chat en ese momento.

Exportar necesita ffmpeg. En el Mac:

```bash
brew install ffmpeg
```

### Marca

- **Artes**: sube logo, avatar del personaje, marco, fondos de las pantallas de inicio, pausa y despedida, e imagen y sonido de alerta. Se aplican al momento.
- **Identidad**: nombre del personaje, color principal y redes sociales, que rotan en una esquina del directo.
- **Fuentes para OBS**: direcciones del overlay y de las tres pantallas, listas para copiar.

Las artes también se pueden dejar en la carpeta [`brand/`](brand/README.md) del proyecto.

### Ajustes

Plataformas, co-host y voz, filtro y comandos del chat, clips, OBS y claves.

## Extras

- **Comandos del chat**: define `redes = Síganme en TikTok` y cuando alguien escriba `!redes` el personaje lo dirá.
- **Memoria de espectadores**: el personaje sabe quién escribe por primera vez y quién es habitual.
- **Alertas**: suscripciones, regalos, donaciones y seguidores aparecen en pantalla con tu imagen y sonido.
- **Voz y cerebro en local**: en un Mac con Apple Silicon la voz puede generarse sin ElevenLabs (mlx-audio) y el personaje puede pensar sin Claude (Ollama). Ver [docs/voz-local.md](docs/voz-local.md).
- **Comentar el juego**: opcional; con OBS conectado, el personaje mira una captura de la partida cuando habla por su cuenta.
- **Atajos en la app de escritorio**: `Cmd+Shift+C` guarda un clip, `Cmd+Shift+P` pausa o reanuda al personaje y `Cmd+Shift+S` salta lo que está diciendo.

## El personaje

Un capo paisa de ficción que habla con voseo y tiene tres registros: campechano, sube la voz y serio y espaciado. Su personalidad, forma de hablar y límites están en [persona/personaje.md](persona/personaje.md); `{{NOMBRE}}` y `{{JUEGO}}` se rellenan con los ajustes del panel.

Los botones **Intro**, **Despedida** y **Vuelvo enseguida** de la pestaña Directo hacen que diga uno de sus guiones fijos al azar; se editan en Ajustes → Guiones, y hay más ejemplos en [docs/guiones.md](docs/guiones.md).

La voz por defecto es «SEBASTIAN PAISA» de ElevenLabs: añádela a «Mis voces» en tu cuenta. En el directo se usa Flash v2.5, que es rápido; al jugar solo y al narrar clips, v4, que suena más humano y entiende el acento paisa y los cambios de tono. Ver [docs/jugar-solo.md](docs/jugar-solo.md).

## Desarrollo

```bash
npm test
```

| Carpeta | Contenido |
|---|---|
| `src/connectors/` | Chat de Twitch (IRC anónimo), YouTube (API oficial), TikTok (librería no oficial) y simulador |
| `src/chat/` | Filtro y selector de mensajes |
| `src/clips/` | Momentos destacados, biblioteca de vídeos y exportación con ffmpeg |
| `src/brand.ts` | Kit de marca: huecos para las artes |
| `src/obs.ts` | Control de OBS: emisión, grabación, búfer de repetición, escenas |
| `src/stats.ts`, `src/viewers.ts` | Estadísticas del directo y memoria de espectadores |
| `src/agent/` | Personaje (Claude o modelo local), troceado por frases y orquestación |
| `src/voice/` | Voz por streaming con ElevenLabs o con un servidor local |
| `scripts/` | `probar-voz`: mide la voz local en tu ordenador |
| `src/server.ts`, `src/app.ts` | Servidor local (solo 127.0.0.1) y unión de todo |
| `public/` | Panel de control, overlay y pantallas para OBS |
| `brand/` | Artes de la marca incluidas en el proyecto |
| `electron/` | Ventana de escritorio |

## Límites conocidos

- **YouTube**: cada consulta al chat gasta cuota de la API. Con la cuota gratuita y el intervalo por defecto (6 s) alcanza para unas 3,3 h de directo al día; el panel lo calcula al cambiar el intervalo.
- **TikTok**: no hay API oficial de chat. El conector puede dejar de funcionar si TikTok cambia algo; el resto de la app no se ve afectado.
- **Clips**: el vídeo sale del búfer de repetición o de las grabaciones de OBS. Graba en MP4 para poder previsualizar en el panel; otros formatos se exportan igual pero no se ven en el editor.
- **Emitir en TikTok desde ordenador** requiere que TikTok te dé clave de stream (normalmente a partir de ~1.000 seguidores).
