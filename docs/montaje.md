# Guía de montaje

## 1. Consola y capturadora

```
Consola ──HDMI──> Capturadora ──HDMI OUT (passthrough)──> TV o monitor
                       │
                      USB
                       ▼
                   Mac mini
```

- Juega siempre mirando la TV conectada al passthrough: la imagen que llega al Mac lleva algo de retraso.
- GTA VI solo sale para PS5 y Xbox Series X|S. En la Xbox One S puedes estrenar el canal con GTA V o GTA Online; el montaje es el mismo.
- En la consola, desactiva HDCP si la capturadora muestra la pantalla en negro (en PS5: Ajustes → Sistema → HDMI).

## 2. OBS

1. Instala [OBS Studio](https://obsproject.com) para macOS.
2. Fuentes de la escena principal, de abajo arriba:
   - **Dispositivo de captura de vídeo**: la capturadora.
   - **Captura de entrada de audio**: la capturadora (sonido del juego).
   - **Navegador**: dirección `http://127.0.0.1:4747/overlay/`, tamaño 1920 × 1080. Marca **Controlar el audio vía OBS** para que la voz del personaje salga en el directo y puedas ajustar su volumen en el mezclador.
3. Ajustes → Salida: 1080p, 6.000 kbps para Twitch y YouTube, fotograma clave cada 2 s. Codificador por hardware de Apple.

Variantes del overlay, por si quieres colocar cada parte por separado:

| Dirección | Muestra |
|---|---|
| `/overlay/` | Chat, subtítulos y voz |
| `/overlay/?chat=0` | Solo subtítulos y voz |
| `/overlay/?subs=0&audio=0` | Solo chat |

Usa una sola fuente con audio; si pones dos, la voz sonará doble.

## 3. Emitir a varias plataformas

OBS solo emite a un destino por sí mismo. Opciones:

- **Plugin Aitum Multistream** u **obs-multi-rtmp** (gratis): añades Twitch, YouTube y TikTok cada uno con su servidor y clave. Consume más subida: calcula unos 6 Mbps por destino.
- **Restream** u otro servicio de reenvío (de pago para algunas plataformas): OBS emite una vez y el servicio reparte.

Claves de emisión:

- **Twitch**: Panel de control del creador → Ajustes → Emisión.
- **YouTube**: YouTube Studio → Emitir en directo → Emisión.
- **TikTok**: LIVE Center → Go Live, si tu cuenta tiene acceso a servidor y clave. Cambia en cada directo.

## 4. Control de OBS desde StreamBot (opcional)

En OBS: Herramientas → Ajustes del servidor WebSocket → activar y copiar la contraseña. En StreamBot: Claves → Contraseña de OBS WebSocket, y luego OBS → Conectar con OBS. Podrás empezar y parar la emisión desde el panel.

## 5. Claves

| Servicio | Dónde se consigue | Para qué |
|---|---|---|
| Anthropic | console.anthropic.com → API keys | Lo que dice el personaje |
| ElevenLabs | elevenlabs.io → perfil → API keys | La voz |
| YouTube Data API v3 | console.cloud.google.com → crear proyecto → activar la API → Credenciales → Clave de API | Leer el chat de YouTube |

Twitch y TikTok no necesitan clave para leer el chat.

## 6. La voz

En ElevenLabs, crea la voz del personaje con Voice Design (por ejemplo: hombre colombiano de unos 45 años, acento paisa, voz grave, ritmo pausado y seguro). Guarda la que te guste y copia su ID en StreamBot → Personaje y voz. No uses la voz de una persona real: lo prohíben ElevenLabs y las normas de Rockstar.

## 7. Antes de cada directo

1. Abre StreamBot y OBS.
2. Comprueba en el panel que el overlay aparece como conectado.
3. YouTube: pega el enlace del directo de hoy y guarda.
4. Activa el chat simulado un momento para oír la voz y ajustar el volumen en OBS; luego desactívalo.
5. Empieza la emisión.

Indica en el título o la descripción del canal que la voz es generada con IA. El overlay ya lo muestra junto al nombre del personaje.
