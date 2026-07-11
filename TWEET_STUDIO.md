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

## Flujo diario típico

1. Terminas algo → le dices a Claude "sube el contexto de hoy" o lo pegas en `/tweet-studio` → pestaña **Contexto** (con captura/video drag & drop).
2. A las ~6am, `planDailyTweets` agenda 2 tweets en tus slots usando el contexto pendiente más antiguo.
3. Cada 10 min, `autoPublishDueTweets` postea lo vencido.
4. En la página puedes revisar la cola, editar textos, cambiar horas, o publicar al instante.
