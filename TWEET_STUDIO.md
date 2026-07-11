# Tweet Studio

Automatiza tweets a tu cuenta de X a partir de un **registro diario de contexto** ("hoy creamos trigger_storm con Fable 5 y modelos de Tripo"). El contexto se guarda en DynamoDB (TTL 15 días), la media (capturas/clips) en S3 (lifecycle 15 días), OpenAI redacta los tweets con formatos virales de indie hacking, y un cron los publica solo — por defecto **2 tweets al día**.

## Arquitectura

```
[Tú / Claude]  →  POST /tweet-studio/activity   (contexto del día + media)
                        │
                        ▼
        dev-tweet-studio-activity (Dynamo, TTL 15d)
        dev-tweet-studio-media-du-portfolio (S3, lifecycle 15d)
                        │
      planDailyTweets (cron 11:00 UTC ≈ 6am Guayaquil)
      → toma contexto "pending", llama a OpenAI, agenda 2 tweets/día
                        │
                        ▼
        dev-tweet-studio-scheduled (Dynamo, GSI status+scheduledAt)
                        │
      autoPublishDueTweets (cron cada 10 min)
      → refresca token de X, sube media (chunked), postea tweet + hilo
                        │
                        ▼
                  https://x.com/…
```

También puedes generar drafts y programar/publicar manualmente desde la página `/tweet-studio` del portfolio (drag & drop de imagen/video incluido).

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/tweet-studio/status` | Conexión X, scope media, contadores, config |
| GET/POST | `/tweet-studio/activity` | Listar / crear registros de contexto |
| DELETE | `/tweet-studio/activity/{id}` | Borrar registro |
| POST | `/tweet-studio/media` | Presigned URL para subir imagen/video a S3 |
| POST | `/tweet-studio/generate` | OpenAI → drafts virales (por `activityId` o contexto inline) |
| GET/POST | `/tweet-studio/tweets` | Listar / programar tweets |
| PATCH/DELETE | `/tweet-studio/tweets/{id}` | Editar / borrar (no editable si ya posteó) |
| POST | `/tweet-studio/tweets/{id}/publish` | Publicar ya, manualmente |

## Registro de contexto (lo que tú o Claude suben)

```json
POST /tweet-studio/activity
{
  "title": "Trigger Storm",
  "context": "Hoy creamos un nuevo juego top-down shooter llamado trigger_storm. Usamos Claude Fable 5 para todo el código Godot y la API de Tripo para generar los modelos 3D. Sistema de armas con crates, escudos y física de rebotes.",
  "appId": "10000-offline-games",
  "toolsUsed": ["Claude Fable 5", "Tripo API", "Godot"],
  "tags": ["gamedev", "indiedev"],
  "media": [{ "key": "tweet-studio/2026-07-10/image/….png", "kind": "image" }]
}
```

Cuanto más específico el `context` (números, herramientas, tiempo que tomó), mejores tweets salen. **No inventes métricas**: el prompt le prohíbe a OpenAI inventar datos que no estén en el contexto.

## Formatos virales (los que usa el generador)

Basados en lo que funciona para cuentas build-in-public tipo levelsio, alexcooldev, marc lou:

1. **Build in public update** — Hook de <10 palabras en la primera línea ("Day 42 of building X:"), luego qué shippeaste + un número honesto. Las primeras líneas cortas rinden ~3x más.
2. **Before / After** — Contraste de dos estados. "Ayer: nada. Hoy: trigger_storm jugable." Ideal con captura o clip.
3. **How I built X in Y** — Stack específico + tiempo específico ("Built a full game in 1 day with Fable 5 + Tripo"). La gente los guarda.
4. **Contrarian take** — Opinión defendible que invita debate.
5. **Lesson / failure** — Un error y su fix. Las historias personales generan más replies que los consejos genéricos.
6. **Mini list** — 3-5 bullets con saltos de línea (no hilo). Herramientas, tips, pasos.

Reglas transversales que aplica el prompt:
- Números concretos > hype vago (las versiones precisas generan mucho más engagement).
- **Sin links** salvo que tú los pongas (los links reducen alcance; lo pediste por costos/rendimiento).
- 1-3 hashtags nicho máximo (`#buildinpublic`, `#indiedev`, `#gamedev`) — nada de spam.
- La media manda: el algoritmo de X premia posts con imagen ~2x sobre texto plano. Sube captura o clip siempre que puedas.
- Hilos: el primer tweet debe funcionar solo como hook; los `threadParts` amplían.

## Configuración (una sola vez)

1. **Scope de media en X**: se agregó `media.write` a los scopes. Entra a `/tweet-studio` y **reconecta X** una vez para que el refresh token nuevo incluya subida de media.
2. **SSM**: ya usas `/duportfolioapi/{stage}/openai/api-key`. No hay parámetros nuevos.
3. **Env opcionales** (`serverless.ts` → defaults):
   - `TWEET_STUDIO_TIMEZONE` = `America/Guayaquil`
   - `TWEET_STUDIO_DAILY_TARGET` = `2`
   - `TWEET_STUDIO_SLOTS` = `13:00,20:00` (hora local; 1pm y 8pm rinden bien para audiencia US/EU)
   - `OPENAI_TWEET_MODEL` = `gpt-5.4-mini`
4. Deploy: `npx serverless deploy` (crea 2 tablas + bucket + 13 lambdas + 2 crons).

## Costos

- Dynamo PAY_PER_REQUEST + TTL 15 días → centavos.
- S3 con lifecycle 15 días → la media se borra sola.
- OpenAI `gpt-5.4-mini` con ~900 tokens de salida por generación → ~$0.001 por tweet.
- Sin links en tweets → mejor alcance orgánico sin gastar en ads.

## Referencia de API para agentes (Codex, Claude, etc.)

Si eres una IA trabajando con este proyecto, esto es todo lo que necesitas para operar Tweet Studio sin leer el código.

**Base URL:** no se publica en este repo porque los endpoints no tienen auth. Tómala de `NEXT_PUBLIC_PORTLOADER_API` en `Portfolio-du/.env.local` (mismo directorio padre que este repo), o de la salida de `npx serverless info`. En los ejemplos, `$BASE` es esa URL.
Todas las respuestas son JSON con `message`; errores devuelven 4xx/5xx con `{ "message": "..." }`.

### Receta 1 — Subir el contexto del día (lo más común)

```bash
curl -X POST "$BASE/tweet-studio/activity" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Trigger Storm",
    "context": "Creamos un top-down shooter en Godot en 1 día. Código con Claude Fable 5, modelos 3D con la API de Tripo. Armas con crates, escudos, física de rebote.",
    "appId": "10000-offline-games",
    "toolsUsed": ["Claude Fable 5", "Tripo API", "Godot"],
    "tags": ["gamedev", "indiedev"]
  }'
# → 201 { "activity": { "id": "act_…", "status": "pending", … } }
```

Con eso basta: el cron `planDailyTweets` lo convertirá en tweet automáticamente al día siguiente. Campos: solo `context` es obligatorio. `status` nace en `pending`; pasa a `used` cuando se agenda un tweet desde él.

### Receta 2 — Adjuntar captura o video (2 pasos)

```bash
# Paso 1: pedir presigned URL
curl -X POST "$BASE/tweet-studio/media" \
  -H "Content-Type: application/json" \
  -d '{ "fileName": "trigger_storm.png", "contentType": "image/png", "sizeBytes": 812345 }'
# → { "media": { "key": "tweet-studio/2026-07-10/image/…png", "kind": "image" }, "uploadUrl": "https://s3…" }

# Paso 2: subir el archivo al uploadUrl
curl -X PUT "<uploadUrl>" -H "Content-Type: image/png" --data-binary @trigger_storm.png
```

Luego incluye `media: [{ "key": "<key del paso 1>", "kind": "image" }]` en el body de la actividad (Receta 1) o del tweet (Receta 4). Límites de X: imagen ≤ 5MB, video ≤ 512MB, máx 4 imágenes **o** 1 video por tweet.

### Receta 3 — Generar drafts con OpenAI

```bash
# Desde un registro guardado:
curl -X POST "$BASE/tweet-studio/generate" \
  -H "Content-Type: application/json" \
  -d '{ "activityId": "act_…", "count": 3 }'

# O con contexto inline (sin guardar registro):
curl -X POST "$BASE/tweet-studio/generate" \
  -H "Content-Type: application/json" \
  -d '{ "context": "Hoy shippeamos X con Y", "count": 3, "tone": "confident indie builder" }'
# → { "drafts": [{ "format": "build-in-public", "text": "…", "hashtags": ["#indiedev"], "threadParts": ["…"] }], "model": "gpt-5.4-mini" }
```

`formats` opcional: array con ids de `build-in-public`, `before-after`, `how-i-built`, `contrarian`, `lesson-learned`, `listicle`.

### Receta 4 — Programar un tweet

```bash
curl -X POST "$BASE/tweet-studio/tweets" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Day 1 of trigger_storm:\nfull top-down shooter, built with Fable 5 + Tripo.",
    "hashtags": ["#buildinpublic", "#gamedev"],
    "scheduledAt": "2026-07-11T20:00:00-05:00",
    "media": [{ "key": "tweet-studio/…/….png", "kind": "image" }],
    "sourceActivityId": "act_…",
    "threadParts": ["Tools: Godot + Tripo API for the 3D models."]
  }'
# → 201 { "tweet": { "id": "twt_…", "status": "scheduled", "scheduledAt": 1783738800 } }
```

`scheduledAt` acepta ISO string o epoch (segundos o ms); si lo omites, se agenda a +10 min. `status: "draft"` lo guarda sin publicar. El cron lo postea cuando llega la hora. Al programar con `sourceActivityId`, esa actividad se marca `used`.

### Receta 5 — Gestionar la cola

```bash
curl "$BASE/tweet-studio/tweets"                          # listar (más recientes primero)
curl -X PATCH "$BASE/tweet-studio/tweets/twt_…" \
  -H "Content-Type: application/json" \
  -d '{ "text": "nuevo texto", "scheduledAt": "2026-07-12T13:00:00-05:00" }'   # editar (no si ya posteó)
curl -X POST "$BASE/tweet-studio/tweets/twt_…/publish"    # publicar YA (ignora la hora)
curl -X DELETE "$BASE/tweet-studio/tweets/twt_…"          # eliminar
curl "$BASE/tweet-studio/status"                          # conexión X, contadores, config
```

Estados de un tweet: `draft → scheduled → publishing → posted` (o `failed` con campo `error`, reintenta con `/publish`; o `canceled`). Cuando postea: `tweetUrl` y `xTweetId` quedan en el registro.

### Reglas para el agente

- Sé específico en `context`: herramientas, números, tiempo que tomó. El prompt de OpenAI tiene prohibido inventar métricas, así que lo que no esté en el contexto no saldrá en el tweet.
- No incluyas links en los tweets (reducen alcance y es preferencia del dueño).
- Verifica `GET /tweet-studio/status` antes de publicar: `connected` debe ser `true` y `canPostMedia` `true` si adjuntas media.

## Flujo diario típico

1. Terminas algo → le dices a Claude "sube el contexto de hoy" o lo pegas en `/tweet-studio` → pestaña **Contexto** (con captura/video drag & drop).
2. A las ~6am, `planDailyTweets` agenda 2 tweets en tus slots usando el contexto pendiente más antiguo.
3. Cada 10 min, `autoPublishDueTweets` postea lo vencido.
4. En la página puedes revisar la cola, editar textos, cambiar horas, o publicar al instante.
