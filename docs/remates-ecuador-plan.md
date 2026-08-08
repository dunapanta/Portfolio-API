# Remates Ecuador - plan técnico

Fecha de inspección: 7 de agosto de 2026. Zona horaria funcional: `America/Guayaquil`.

## Arquitectura detectada

- Frontend: `Portfolio-du`, Next.js 13 Pages Router, React 18, TypeScript y Tailwind. Las herramientas viven en `/src/pages/tools`, las pantallas full-screen se registran en `src/pages/_app.tsx` y el dropdown se define en `src/components/Navbar.tsx`. El frontend se publica en Vercel y consume `NEXT_PUBLIC_PORTLOADER_API`.
- Backend: `Portfolio-API`, Serverless Framework 4 sobre AWS Lambda Node.js 22 en `us-east-1`. Las funciones se registran en `serverless/functions.ts`; DynamoDB en `serverless/dynamoResources.ts`; S3 y variables compartidas en `serverless.ts`.
- Persistencia: varias tablas DynamoDB por herramienta, modo `PAY_PER_REQUEST`. Se conserva el patrón existente, pero Remates usa una tabla propia con registros `AUCTION` y `SCRAPE_RUN`.
- Documentos: bucket S3 nuevo, privado, cifrado SSE-S3 y con bloqueo de acceso público. El frontend recibe solamente URL prefirmada de corta duración desde el endpoint de detalle.
- Secretos: OpenAI se obtiene desde el SSM ya existente. `OPENAI_EXTRACTION_MODEL` es configurable. El trigger manual usa el secreto administrativo existente y `X-Remates-Admin-Key`.

## Hallazgos BIESS

Portal oficial: `https://rematevirtual.biess.fin.ec/subasta_prendarios_web/web/portal_remate.xhtml`.

- Tecnología: JSF + PrimeFaces 6.2 sobre JBoss. El listado usa `DataGrid` y paginación AJAX con `javax.faces.ViewState`, `_csrf` y cookie `JSESSIONID`.
- Selectores de validación Playwright:
  - grid: `[id="formPortalId:bienesId_content"]`
  - card: `.ui-datagrid-column`
  - paginador: `.ui-paginator-current`
  - siguiente: `getByRole("link", { name: "Next Page" })`
  - extracto: `getByText("DESCARGAR EXTRACTO DEL REMATE")`
  - código: texto que cumple `/BIESS-[A-Z]+-\d{4}-\d{4}/`
- Oficinas públicas activas observadas: `oficina=15` Quito y `oficina=16` Guayaquil.
- El `rowCount` declarado por el portal (`479`, `118`, o `597` sin filtro) no representa las filas visibles actuales. También muestra hasta 100 páginas aunque muchas estén vacías.
- Recorrido real por contenido:
  - Quito: 7 páginas con datos y página 8 vacía; 38 IDs únicos.
  - Guayaquil: 5 páginas con datos y página 6 vacía; 27 IDs únicos.
  - Total: 65 IDs únicos, 12 páginas no vacías, 2 páginas vacías de terminación.
- Hay duplicados entre páginas; la parada correcta combina página vacía, página idéntica y ausencia de IDs nuevos. `MAX_PAGES_PER_SOURCE` es solo un fusible.
- La descarga no expone un URL estático. Es un POST del formulario JSF con un control como `formPortalId:bienesId:0:j_idt108`; la respuesta es `application/octet-stream` con `Content-Disposition` y bytes PDF.
- La ficha de detalle también se abre por POST JSF, con un control como `...:j_idt89`.

## Caso de control BIESS-UIO-2026-0110

- Detalle web: `N° Señalamiento: PRIMERO`.
- Extracto oficial, página 1: `TERCER SEÑALAMIENTO`.
- Avalúo: USD 251.967,44.
- Base: USD 125.983,72, expresamente descrita como la mitad del avalúo.
- Fecha del remate: 17 de agosto de 2026, ofertas de 00:00 a 24:00.
- Inmueble: apartamento 1, parqueadero G4 y bodega 3 del Edificio Semirabad, Jardines del Batán, Quito.
- Las alícuotas son de propiedad horizontal. No hay texto que limite el remate a acciones y derechos; se valida como 100% de la unidad descrita.
- El PDF es escaneado y no tiene texto nativo. Se requiere el fallback de archivo PDF/visión.
- SHA-256 observado: `5b22fabdf6cb80dfac3885daa2257caaa16d16e55ca951e1424cfdc07f4fbbf0e`.

## Fuentes oficiales validadas

- SRI: página anual estática de Liferay. Cada inmueble enlaza directamente un aviso PDF; el adapter conserva la URL oficial, hash y copia privada. En la validación del 8 de agosto se detectaron 7 avisos inmobiliarios de 2026.
- Consejo de la Judicatura: JSF/RichFaces. La búsqueda por tipo separa inmuebles urbanos y rurales; ambas listas se recorren con paginación dinámica. El detalle se abre mediante ViewState y el botón `Informe Pericial` entrega un PDF oficial. Una prueba de una página por clasificación encontró 20 inmuebles y descargó un informe de 14 páginas.
- Portal CFN/Banco del Pacífico/BanEcuador: JSF/PrimeFaces. El código `cod_emp` identifica la institución (`01` CFN, `02` Banco del Pacífico y el código restante BanEcuador). El detalle confirma `Tipo de Bien: INMUEBLE` y expone providencia e informe pericial. Actualmente el portal indicó 24 activos CFN, 25 de Banco del Pacífico y 0 de BanEcuador; el adapter conserva BanEcuador aunque hoy no tenga publicaciones.

## Diseño implementado

```text
EventBridge semanal / trigger admin
              |
              v
       syncRemates Lambda
   adapters HTTP + cookies/ViewState
              |
      +-------+--------+
      |                |
      v                v
 DynamoDB listing   S3 PDF privado
                       |
                       v
                 SQS extracción
                       |
                       v
            extractRemateDocument
             unpdf -> OpenAI PDF
                       |
                       v
             DynamoDB normalizado
                       |
                       v
             API pública de lectura
                       |
                       v
           /tools/remates-ecuador
```

El navegador no se empaqueta en Lambda: Playwright se mantiene para investigación y validación local, mientras producción reproduce el protocolo JSF observado. Esto reduce drásticamente el tamaño y tiempo de arranque sin saltarse controles de acceso ni protecciones.

## Fases

1. BIESS local: completada. Playwright headed, paginación dinámica, 10 PDFs reales, caso 0110 y fixtures de expectativa.
2. Extracción: `unpdf` primero; si el texto es insuficiente, Responses API con `input_file` PDF y Structured Outputs. Hash + versiones evitan repetir IA.
3. Persistencia/API/UI: tabla y bucket dedicados, SQS, API de lectura, panel con filtros, ranking y detalle/provenance.
4. Cobertura multifuente: completada para SRI, Consejo de la Judicatura y el portal conjunto CFN/Banco del Pacífico/BanEcuador. Todos priorizan el PDF oficial cuando existe.

## Ranking

- `dealScore`: usa únicamente descuento frente al avalúo, señalamiento, propiedad completa y verificación. Nunca lo presenta como descuento frente al mercado.
- `verificationScore`: documento, dirección, propiedad, base, fecha y señalamiento confirmados.
- El ranking principal excluye `isFullOwnership === false` y estados vencidos/cancelados/adjudicados; los filtros permiten inspeccionarlos.

## Operación y seguridad

- Cuatro schedulers semanales escalonados evitan que una fuente lenta bloquee a las demás. Son configurables con `REMATES_BIESS_WEEKLY_SCHEDULE`, `REMATES_SRI_WEEKLY_SCHEDULE`, `REMATES_CJ_WEEKLY_SCHEDULE` y `REMATES_CFN_WEEKLY_SCHEDULE`.
- `REMATES_MAX_DOCUMENTS_PER_SOURCE_PER_RUN` limita descargas nuevas por fuente. Los pendientes se priorizan automáticamente en la corrida siguiente; los documentos ya verificados se vuelven a comprobar según `REMATES_DOCUMENT_REFRESH_DAYS`.
- `REMATES_MAX_EXTRACTIONS_PER_RUN` limita trabajos nuevos por corrida; SQS desacopla cada PDF y su retry.
- Un PDF corrupto no detiene el discovery; el run termina `PARTIAL_SUCCESS` y conserva errores por ítem.
- No se rompen CAPTCHA, login o controles antibot. Si BIESS los introduce, el run se registra como fallido/bloqueado.
- Logs JSON por `runId`, acción, ítem, estado y duración; nunca incluyen secretos.

## Criterio para fuentes futuras

Cada adaptador debe demostrar primero: fuente oficial, alcance actual, paginación real, URL/documento de mayor autoridad, fixtures representativos, campos faltantes, condición de parada y tasa de extracción revisada.
