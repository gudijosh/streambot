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
| `/overlay/` | Chat, subtítulos, voz, alertas, logo, marco y redes |
| `/overlay/?chat=0` | Todo menos el chat |
| `/overlay/?subs=0&audio=0&alerts=0&brand=0` | Solo chat |

Usa una sola fuente con audio; si pones dos, la voz sonará doble.

### Pantallas de inicio, pausa y despedida

Crea en OBS una escena para cada una con una fuente de navegador a 1920 × 1080:

| Escena | Dirección |
|---|---|
| Empezamos pronto | `/overlay/scene.html?tipo=starting&min=5` |
| Vuelvo enseguida | `/overlay/scene.html?tipo=brb` |
| Fin del directo | `/overlay/scene.html?tipo=ending` |

Usan el fondo que subas en la pestaña Marca. Opciones: `min=5` pone una cuenta atrás, `texto=...` cambia el título, `chat=0` quita el chat y `arte=solo` muestra solo tu diseño, sin textos encima. Las direcciones completas se copian desde Marca → Fuentes de navegador para OBS.

### Clips

1. En OBS: Ajustes → Salida → Búfer de repetición → activar, con 30 a 60 segundos.
2. Ajustes → Salida → Grabación → formato MP4 (o MP4 híbrido), para poder ver los vídeos en el editor de StreamBot.
3. En StreamBot, enciende **Búfer de repetición** en la pestaña Directo al empezar. Desde entonces, **Guardar clip**, `!clip` en el chat y los picos del chat guardan los últimos segundos.
4. Instala ffmpeg para exportar: `brew install ffmpeg`.

## 3. Emitir a varias plataformas

OBS solo emite a un destino por sí mismo. Opciones:

- **Plugin Aitum Multistream** u **obs-multi-rtmp** (gratis): añades Twitch, YouTube y TikTok cada uno con su servidor y clave. Consume más subida: calcula unos 6 Mbps por destino.
- **Restream** u otro servicio de reenvío (de pago para algunas plataformas): OBS emite una vez y el servicio reparte.

Claves de emisión:

- **Twitch**: Panel de control del creador → Ajustes → Emisión.
- **YouTube**: YouTube Studio → Emitir en directo → Emisión.
- **TikTok**: LIVE Center → Go Live, si tu cuenta tiene acceso a servidor y clave. Cambia en cada directo.

## 4. Control de OBS desde StreamBot

En OBS: Herramientas → Ajustes del servidor WebSocket → activar y copiar la contraseña. En StreamBot: Ajustes → Claves → Contraseña de OBS WebSocket, y en Ajustes → OBS marca «Conectar con OBS automáticamente». Desde la pestaña Directo podrás emitir, grabar, cambiar de escena y guardar clips.

## 5. Claves

| Servicio | Dónde se consigue | Para qué |
|---|---|---|
| Anthropic | console.anthropic.com → API keys | Lo que dice el personaje |
| ElevenLabs | elevenlabs.io → perfil → API keys | La voz |
| YouTube Data API v3 | console.cloud.google.com → crear proyecto → activar la API → Credenciales → Clave de API | Leer el chat de YouTube |

Twitch y TikTok no necesitan clave para leer el chat.

## 6. La voz

StreamBot usa la voz «SEBASTIAN PAISA» de la biblioteca de ElevenLabs. Guárdala en «Mis voces» de tu cuenta: cómo hacerlo, y qué hacer si el dueño la retira, está en [voz-elevenlabs.md](voz-elevenlabs.md). No clones la voz de una persona real sin su permiso: lo prohíben ElevenLabs y las normas de Rockstar.

## 7. Cuánto cuesta el directo

Cálculo con los ajustes por defecto: Claude Haiku 5.5 como cerebro, ElevenLabs Flash v2.5 como voz (0,5 créditos por carácter) y respuestas de una a tres frases, unas 150 letras.

**Claude** cuesta unos 0,0003 USD por respuesta con Haiku: de 2 a 10 céntimos de dólar por hora, y de 1 a 3 USD al mes. Con Sonnet 5.5, más ingenioso, de 0,50 a 2 USD por hora. Hace falta una clave de API con saldo; la suscripción de Claude.ai no sirve.

**ElevenLabs** es el gasto de verdad:

| Cómo está el chat | Intervenciones por hora | Créditos por hora |
|---|---|---|
| Callado (habla solo cada 90 s) | ~40 | unos 3.000 |
| Normal | ~120 | unos 9.000 |
| Muy activo (casi sin parar) | ~240 | unos 18.000 |

Con 26 horas al mes (tres directos de 2 horas a la semana) son entre 235.000 y 470.000 créditos: el plan Pro (600.000 créditos). Con unas 10 horas al mes basta el plan Creator (121.000 créditos). El plan Starter (30.000–40.000 créditos) da para unas 4 horas, y ahí van también los shorts con v4, que cuesta el doble por carácter.

Para gastar menos:

- Sube el tiempo para hablar solo o ponlo en 0 (Ajustes → Co-host y voz). Por defecto es de 90 segundos.
- Sube la pausa mínima entre respuestas a 10–15 segundos: contestará a lo mejor del chat en vez de a todo.
- Mira los créditos gastados en la pestaña Directo → «Este directo» y ajusta tras los primeros directos.

## 8. Antes de cada directo

1. Abre StreamBot y OBS.
2. Comprueba en el panel que el overlay y OBS aparecen como conectados, y enciende el búfer de repetición.
3. YouTube: pega el enlace del directo de hoy y guarda.
4. Activa el chat simulado un momento para oír la voz y ajustar el volumen en OBS; luego desactívalo.
5. Empieza la emisión.

Indica en el título o la descripción del canal que la voz es generada con IA. El overlay ya lo muestra junto al nombre del personaje.
