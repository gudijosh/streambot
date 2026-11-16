---
name: voz-mr-escobar
description: Voz y forma de hablar de Mr. Escobar, el personaje paisa del canal de GTA. Úsala siempre que haya que generar audio con su voz en ElevenLabs (shorts, intros, despedidas, guiones, narraciones), escribir o revisar textos que dirá el personaje, ajustar la voz de StreamBot, o cuando el usuario pida «la voz de Mr. Escobar», «la voz del patrón» o «la voz del personaje».
---

# Voz de Mr. Escobar

Mr. Escobar es un capo paisa **de ficción** que vive dentro de GTA (Vice City). Es el alter ego del dueño del canal, que se apellida Escobar. No es Pablo Escobar ni lo imita.

## La voz que funciona

Probada y aprobada por el usuario el 15-16 de noviembre de 2026:

| Ajuste | Valor |
|---|---|
| Voz | **SEBASTIAN PAISA**, de la biblioteca de ElevenLabs. ID `bnes5tb6xZ5GxqUjhUSq` |
| Modelo | **`eleven_v4`**, el único que entiende las indicaciones de tono entre corchetes |
| Delante de cada texto | `[strong Antioquian Paisa accent, drawn-out s]` |
| Tomas | 2 por texto (lo normal del conector), para que el usuario elija |

Se genera con la herramienta `creative_generate_speech` del conector de ElevenLabs, pasando `voice_id`, `model_id: "eleven_v4"` y el texto con la indicación de acento delante.

**Lo que no funcionó (no repetir):**
- Voces diseñadas desde una descripción (`creative_design_voice`): las dos rondas sonaron «a bot», sin canto paisa.
- Otras voces colombianas de la biblioteca (Cronos Paint, SebasPerez, anyelo 1, Oscar López…): Cronos Paint y SebasPerez «se escuchan bien», pero el usuario eligió Sebastián Paisa.
- El modelo Flash v2.5 suena más plano y no entiende los corchetes. Solo se usa en el directo con chat de StreamBot, por la latencia.

## Indicaciones de tono

Van entre corchetes y en inglés, delante del trozo al que afectan. Como mucho tres o cuatro por cada 20 segundos:

`[relaxed]` `[warm]` `[chuckles]` `[laughs softly]` `[excited, raising voice]` `[serious, low voice]` `[slowly]` `[pause]` `[short pause]` `[long pause]` `[thoughtful]` `[confident]` `[mischievously]`

Los puntos suspensivos también crean pausas: el registro serio se escribe espaciado («Mire… usted sabe… que aquí… las cosas… se hacen bien»).

## Cómo habla

- **Acento antioqueño muy marcado**, con la «s» arrastrada, canto en los finales y voz grave y pausada.
- **«Vos» en confianza** («vos sabés», «mirá», «¿vos sí viste eso?») y **«usted» en lo serio** («Mire, mijo… usted me hace el favor…»). Nunca «tú».
- **Tres registros que se alternan**; el contraste hace al personaje:
  1. Campechano: relajado, bromista, con risitas.
  2. Sube la voz: emoción cuando algo sale muy bien o muy mal.
  3. Serio y espaciado: baja la voz, habla despacio y en «usted», y luego vuelve a la broma.
- **Vocabulario:** quiubo, hágale (pues), de una, ¿sí o qué?, ¿cierto?, vea, pues, eavemaría, ome, mijo, mijito, parce, parcero, llave, socio, pelado, caballero, verraco, bacano, berraquera, sapo, torcido, la vuelta, el camello, camellar, el billete, la plata, los tombos, el parche, la oficina, la nave, tintico, ahoritica.
- **Firma:** «Escobar… Mister Escobar».
- La forma de hablar completa que usa StreamBot está en `persona/personaje.md`, y los guiones de ejemplo en `docs/guiones.md`.

## Límites (no negociables)

- **No clonar ni imitar la voz real de Pablo Escobar**, ni la de imitadores o actores que lo interpretan. Lo prohíben ElevenLabs y las normas de Rockstar.
- **No copiar frases reales de Escobar** (ni «plata o plomo» ni otras) **ni diálogos de series sobre él**, como *El patrón del mal*. De la serie solo se toma el estilo general paisa.
- **No clonar la voz de Sebastián Paisa en modelos locales**: es de una persona real que solo la cede dentro de ElevenLabs. Para voz local, la referencia tiene que ser la voz del usuario o la de alguien que dé permiso por escrito (ver `docs/voz-local.md`).
- **Las amenazas son siempre inventadas y dentro del juego**: a rivales de GTA, por la nave, por la vuelta. Nada de hechos, víctimas ni carteles reales.
- Palabrotas: el usuario las usa a veces en sus guiones. Se respetan si las escribe él, avisando de que pueden limitar los anuncios en YouTube y el alcance en TikTok.

## Entregar el audio al usuario

- Este entorno no puede descargar de `elevenlabsusercontent.com` (lo bloquea el proxy), así que el MP3 no se puede guardar en el repositorio ni mandar como archivo.
- Por cada toma se le pasa:
  - el enlace directo al MP3 (`content_url`), que caduca en unas horas;
  - el enlace a su historial de ElevenLabs (`product_link.url`, con `historyItemId`), que no caduca y tiene botón de descarga.
- Siempre se dice la duración de cada toma, los créditos gastados y los que quedan (`account_get_usage`).
- Nunca se repite una generación para «reintentar»: cobra otra vez. Si una llamada no devuelve resultado, antes de repetirla se comprueba con `creative_list_flows` si llegó a crearse.

## Costes de referencia (plan Starter, 40.000 créditos al mes)

| Qué | Créditos |
|---|---|
| Frase de unos 15 segundos con v4 | unos 250 a 380 por toma |
| Short de 1 minuto con v4 | unos 1.100 por toma |
| Ronda de diseño de voz (3 previsualizaciones) | unos 500 |
| Canción de 1 minuto (`eleven_music_v2_5`) | unos 900 por versión; el estimador marcaba 1.500 |

## Música del canal

- Modelo `eleven_music_v2_5`, mediante `creative_generate_in_flow` con `node_type: "music"`.
- Estilo de Vice City: synthwave retro de los 80, instrumental, sin voces, para ir debajo de la narración.
- El prompt describe solo cómo suena (género, ánimo, instrumentos, tempo, cómo evoluciona), nunca canciones ni artistas concretos.
- Antes de generar, se pide el precio con `estimate_only: true`, y se generan 2 versiones en vez de las 4 por defecto, salvo que el usuario pida otra cosa.
- **Forzar instrumental y duración:** escribir «no vocals» en el prompt no basta. Por defecto el nodo sale con `instrumental: false` y `lyrics_type: "auto"`, y puede meter voces. Para música de fondo:
  1. Crear el nodo de música en un flujo.
  2. Ajustar con `creative_update_node` los parámetros `instrumental: true`, `lyrics_type: "instrumental"` y `duration_seconds` (de 3 a 600).
  3. Ejecutarlo.
  Los nombres de los parámetros salen de `creative_get_model_schema` para `eleven_music_v2_5`.
- La primera canción del canal (16-11-2026, synthwave de 60 s para el short de llegada a Vice City) se generó sin forzar el modo instrumental.
