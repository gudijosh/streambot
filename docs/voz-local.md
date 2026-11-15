# Voz y cerebro en local (Mac con Apple Silicon)

StreamBot puede generar la voz del personaje en tu Mac, sin ElevenLabs, y opcionalmente también lo que dice, sin Claude. Se elige en Ajustes → Co-host y voz, por separado para el cerebro y para la voz, y se puede volver a la nube en cualquier momento.

Recomendación para un Mac mini M4 de 16 GB: **voz local y cerebro en la nube**. La voz es lo que gasta créditos; Claude Haiku cuesta céntimos por directo, y un modelo de texto local ocupa varios gigas que en directo necesita OBS.

## 1. Voz local con mlx-audio

Instala la librería y lo que necesita el español:

```bash
pip install -U mlx-audio misaki
```

```bash
brew install espeak-ng
```

Arranca el servidor de voz y déjalo abierto durante el directo:

```bash
mlx_audio.server --host 127.0.0.1 --port 8000
```

Si el comando se queja de que faltan dependencias del servidor, instálalo con `pip install -U "mlx-audio[server]"`.

En StreamBot: Ajustes → Co-host y voz → Voz → «En este Mac». Los valores por defecto ya apuntan a ese servidor y al modelo Kokoro.

### Qué modelo elegir

| Modelo | En «Modelo» | Voz predefinida | Idioma | Para qué |
|---|---|---|---|---|
| Kokoro (82 M) | `mlx-community/Kokoro-82M-bf16` | `em_alex`, `em_santa` o `ef_dora` | `e` | El más ligero y rápido. Voces fijas, español neutro. Empieza por este. |
| Chatterbox Multilingual | `mlx-community/chatterbox-multilingual-v3` | vacío | `es` | Clona una voz a partir de un audio de referencia. |
| Qwen3-TTS Base | `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit` | vacío | `Spanish` | También clona. Puede ir justo de velocidad. |

Los nombres de voz e idioma de Chatterbox y Qwen3-TTS no los he podido comprobar en un Mac: si el modelo no genera audio, StreamBot lo avisa en el panel y `npm run probar-voz` lista las voces que ofrece el modelo.

La primera vez que se usa un modelo se descarga de Hugging Face y tarda; después queda en disco.

### Medir antes de fiarte

```bash
npm run probar-voz
```

Sintetiza cuatro frases del personaje con lo que tengas configurado, dice cuánto tarda en empezar a sonar cada una y cuántas veces más rápido que el tiempo real va, y guarda `prueba-voz.wav` para que escuches el resultado. Para comparar otro modelo sin cambiar los ajustes:

```bash
npm run probar-voz -- --model mlx-community/chatterbox-multilingual-v3 --voice "" --lang es --ref ~/voz-personaje.wav
```

Haz la prueba **con OBS emitiendo o grabando**, que es cuando el Mac va cargado. Por debajo de 1,1 veces el tiempo real el personaje sonaría a trompicones.

### Voz propia con acento

Ninguno de estos modelos trae una voz paisa. Para acercarte:

1. Consigue un audio de referencia de 10 a 20 segundos, limpio y sin música: tu propia voz o una voz inventada. No uses la voz de una persona real ni de un actor.
2. Para inventar una, el modelo Qwen3-TTS VoiceDesign crea una voz a partir de una descripción. Con el servidor arrancado:

```bash
curl -X POST http://127.0.0.1:8000/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16", "input": "Qué más pues, parceros, bienvenidos a la organización. Aquí el que entra ya es de la familia.", "instruct": "Hombre colombiano de unos cuarenta y cinco años, acento paisa de Medellín, voz grave, ritmo pausado y seguro.", "lang_code": "Spanish", "response_format": "wav"}' \
  --output ~/voz-personaje.wav
```

3. En StreamBot, elige un modelo que clone (Chatterbox o Qwen3-TTS Base), deja «Voz predefinida» vacía y pon la ruta del audio en «Audio de referencia para clonar» y lo que se dice en él en el campo de texto.

El campo `instruct` existe en el servidor, pero no he podido comprobar el resultado en español; puede que necesites varios intentos con la descripción.

## 2. Cerebro local con Ollama (opcional)

```bash
brew install ollama
```

```bash
ollama serve
```

Descarga un modelo pequeño. Para 16 GB las guías recomiendan los de unos 4.000 millones de parámetros (Qwen 3.5 4B, Gemma 4 E4B); comprueba el nombre exacto en ollama.com/library:

```bash
ollama pull qwen3.5:4b
```

En StreamBot: Ajustes → Co-host y voz → Cerebro → «En este Mac», y escribe el modelo tal como aparece en `ollama list`.

A tener en cuenta:

- El modelo local sigue peor que Claude las reglas del personaje (frases cortas, límites, ignorar manipulaciones del chat). Revisa lo que dice en varios ensayos antes de usarlo en directo.
- No ve imágenes: «Comentar lo que pasa en el juego» solo funciona con el cerebro en la nube.
- El título y los hashtags de los clips siguen usando Claude.

## 3. Memoria

Con 16 GB, cuenta aproximadamente:

| Qué | Memoria |
|---|---|
| macOS, OBS a 1080p y StreamBot | 6 a 8 GB |
| Kokoro | menos de 1 GB |
| Chatterbox o Qwen3-TTS 0.6B | 1 a 2 GB |
| Qwen3-TTS 1.7B | unos 4 GB |
| Modelo de texto de 4B | 3 a 4 GB |
| Modelo de texto de 9B | unos 7 GB |

Son estimaciones, no medidas. Kokoro con cerebro en la nube cabe con holgura; voz y cerebro locales a la vez dejan poco margen, y un modelo de texto de 9B no es recomendable con OBS abierto. Si el Mac empieza a usar memoria de intercambio, el directo pierde fotogramas: vigílalo en Monitor de Actividad durante un ensayo.

## 4. Si algo falla

| Aviso en el panel | Qué hacer |
|---|---|
| «No encuentro el servidor de voz local» | Arranca `mlx_audio.server`. |
| «Voz local: Model not found» | Revisa el nombre del modelo en Ajustes. |
| «el modelo no generó audio» | La voz o el código de idioma no valen para ese modelo. |
| «No encuentro el modelo local… ¿Está Ollama abierto?» | Arranca `ollama serve` y pulsa Reanudar. |

Cuando la voz falla, el personaje sigue respondiendo con subtítulos y el aviso desaparece solo en cuanto vuelve a funcionar.
