# Opportunity Radar

Herramienta privada para descubrir nichos de apps en mercados que todavía no forman parte del portafolio. No usa las apps de Daniel como semillas.

## Flujo diario

1. Lee feeds RSS aprobados de Apple por país: apps nuevas gratuitas, top grossing y top pagadas.
2. Selecciona apps externas de publishers y categorías distintas; excluye plataformas gigantes para evitar que dominen la muestra.
3. Consulta `get_keyword_suggestions` del MCP local de Astro para cada App Store ID externo.
4. Conserva únicamente keywords con popularidad `> 20` y `<= 60`.
5. Agrupa fuentes, limita términos por app/categoría y envía snapshots al API.
6. El backend calcula cambio de popularidad/dificultad contra el snapshot anterior, genera una hipótesis de producto y guarda snapshot + estado actual en DynamoDB.

Por defecto rota 12 de 50 mercados por día. Todos los países configurados se recorren en aproximadamente cinco días; se puede reemplazar la lista con `APP_OPPORTUNITIES_COUNTRIES`.

## Infraestructura

- Tabla: `${stage}-app-opportunities`
- Índice `GSI-app-opportunities-recent`: vista actual e historial global.
- Índice `GSI-app-opportunity-history`: historial por país + keyword.
- Clave HTTP: `X-App-Opportunities-Key`.
- La clave reutiliza el parámetro SSM privado `/duportfolioapi/${stage}/magic-layers/access-key` (actualmente `daniel7`). No se expone en el frontend.

## API

```text
POST /app-opportunities/access
GET  /app-opportunities?view=latest&limit=500
GET  /app-opportunities?view=history&limit=1000
POST /app-opportunities/snapshots
```

Ejemplo de ingestión:

```bash
curl -X POST "$APP_OPPORTUNITIES_API_URL/app-opportunities/snapshots" \
  -H "Content-Type: application/json" \
  -H "X-App-Opportunities-Key: $APP_OPPORTUNITIES_ACCESS_KEY" \
  -d '{
    "runId":"astro-2026-07-25-demo",
    "capturedAt":"2026-07-25T12:00:00.000Z",
    "opportunities":[{
      "keyword":"local service planner",
      "store":"fr",
      "popularity":42,
      "difficulty":18,
      "appsCount":74,
      "sourceApps":[{
        "appId":"123456789",
        "appName":"External chart app",
        "category":"Productivity",
        "chart":"topgrossingapplications",
        "chartRank":12
      }]
    }]
  }'
```

## Ejecutar el agente

Astro debe estar abierto, con su MCP activo en `http://127.0.0.1:8089/mcp`.

Prueba sin subir datos:

```bash
APP_OPPORTUNITIES_APPS_PER_COUNTRY=4 \
npm run opportunities:sync -- --countries=fr,br,jp --no-upload
```

Ejecución completa:

```bash
APP_OPPORTUNITIES_API_URL=https://7ts10e4a78.execute-api.us-east-1.amazonaws.com \
APP_OPPORTUNITIES_ACCESS_KEY=daniel7 \
npm run opportunities:sync
```

Variables opcionales:

```text
ASTRO_MCP_URL=http://127.0.0.1:8089/mcp
APP_OPPORTUNITIES_COUNTRIES=fr,br,jp,de,au
APP_OPPORTUNITIES_COUNTRIES_PER_RUN=12
APP_OPPORTUNITIES_APPS_PER_COUNTRY=7
APP_OPPORTUNITIES_RESULTS_PER_COUNTRY=24
APP_OPPORTUNITIES_MCP_CONCURRENCY=4
APP_OPPORTUNITIES_MCP_INTERVAL_MS=2200
```

## Automatización macOS

Instala un LaunchAgent que corre todos los días a las 07:15. La clave queda en un plist privado con permisos `0600`.

```bash
APP_OPPORTUNITIES_API_URL=https://7ts10e4a78.execute-api.us-east-1.amazonaws.com \
APP_OPPORTUNITIES_ACCESS_KEY=daniel7 \
npm run opportunities:install
```

Los logs quedan en `~/Library/Application Support/DuPortfolioOpportunityRadar/logs/`.

## Notas de interpretación

- Popularidad y dificultad vienen de Astro; el score y la posible app son análisis, no garantías de ingresos.
- Un término marcado `skip` se conserva en el historial para evitar redescubrir el mismo ruido como si fuera una señal nueva.
- La tendencia aparece después del segundo snapshot de la misma keyword/país.
- El RSS se usa como fuente de descubrimiento de contexto; no se hace scraping de páginas del App Store.
