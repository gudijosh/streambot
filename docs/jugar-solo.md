# Jugar solo y narrar clips

StreamBot sirve también sin directo: el personaje narra tu partida mientras juegas, o narra después un clip o una grabación. Las dos formas usan la voz que tengas configurada (ElevenLabs o local) y Claude para escribir lo que dice.

Hace falta la **clave de API de Anthropic**. Las suscripciones Claude Pro/Max o ChatGPT Plus no sirven: solo funcionan en sus propias apps. El coste es bajo: narrar en vivo con Claude Haiku sale por menos de 0,10 $ la hora, y narrar un clip de un minuto cuesta céntimos. Lo que más gasta es la voz de ElevenLabs.

## Narrar mientras juegas

1. En OBS deja la escena del juego con la fuente de navegador del overlay (`http://127.0.0.1:4747/overlay/`), con **Controlar el audio vía OBS** marcado. Así la voz del personaje se graba junto al juego.
2. Si no quieres el chat en pantalla, usa `/overlay/?chat=0`.
3. En StreamBot, pestaña Directo, pulsa **Jugar solo**.
4. En OBS, enciende **Grabar** o el **Búfer de repetición** (también desde la pestaña Directo de StreamBot).

A partir de ahí, cada vez que el personaje lleva unos segundos callado (10 por defecto; se cambia en Ajustes → Co-host y voz) StreamBot pide a OBS una captura, Claude la mira y el personaje comenta la jugada. Si ve un menú, una pantalla de carga o nada interesante, se calla.

Con el búfer de repetición encendido, **Guardar clip** (o `Cmd+Shift+C` en la app) guarda los últimos segundos ya narrados.

Limitaciones:
- La narración va unos segundos por detrás de lo que pasa: entre la captura, Claude y la voz pasan 2 o 3 segundos.
- Necesita OBS conectado y el cerebro en la nube; el modelo local no ve imágenes. El panel lo avisa si falta algo.
- En modo Jugar solo no se conecta a ningún chat. Para volver al directo, pulsa **Directo**.

## Narrar un clip o una partida después

Sirve para cualquier vídeo de la pestaña Clips: clips guardados, grabaciones de OBS, de directo o en solitario, o vídeos que añadas por su ruta.

1. Abre el vídeo en el editor y marca el tramo con **Inicio aquí** y **Fin aquí** (hasta 3 minutos).
2. Opcional: en «De qué va el clip» cuenta lo que pasa («me escapo de la policía con el helicóptero»). Ayuda a que la narración acierte.
3. Pulsa **Narrar tramo**.

StreamBot saca un fotograma cada 2 segundos, Claude escribe la narración frase a frase con su segundo exacto, la voz del personaje la lee y se monta sobre el juego. El sonido del juego baja solo mientras habla el personaje y, si dejas marcada la casilla, los subtítulos quedan grabados en la imagen. El resultado es un vídeo nuevo terminado en `_narrado_`; el original no se toca.

Después puedes recortarlo en vertical para TikTok o Shorts y pulsar **Generar título y hashtags**, que ya tiene en cuenta lo que dijo el personaje.

Para mejores resultados, elige Claude Sonnet en Ajustes → Co-host y voz: es más ingenioso que Haiku y el coste por clip sigue siendo pequeño.

## La voz del personaje

Ni ElevenLabs ni StreamBot clonan voces de personas reales, y las normas de Rockstar tampoco lo permiten. La voz del personaje es una voz original diseñada en ElevenLabs a partir de una descripción (hombre colombiano, acento paisa, grave, pausado).

Para usar esa voz con la IA local no se puede descargar el modelo de ElevenLabs. Lo que sí puedes hacer:

1. Genera con tu voz de ElevenLabs un audio limpio de 20 a 30 segundos.
2. Guárdalo en tu Mac y pon su ruta en Ajustes → Co-host y voz → Voz local → «Audio de referencia para clonar», con un modelo que clone (Chatterbox o Qwen3-TTS; ver [voz-local.md](voz-local.md)).

Se parecerá a la original, pero no será idéntica. Revisa antes los términos de ElevenLabs sobre usar su audio en otros modelos.

## Publicar

Indica en la descripción del vídeo que la voz es generada con IA. TikTok, YouTube y Twitch piden etiquetar el contenido hecho con IA que parece real.
