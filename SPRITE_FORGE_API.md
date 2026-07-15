# Sprite Forge API

API asíncrona para generar assets, personajes, poses clave y atlas de partes para juegos 2D.

Base URL de desarrollo desplegado:

```text
https://7ts10e4a78.execute-api.us-east-1.amazonaws.com
```

## Autenticación

Configura `SPRITE_STUDIO_KEY` al desplegar. No existe una clave predeterminada en el código y los
handlers fallan cerrados si la variable falta. La clave de OpenAI se lee desde SSM.

En los ejemplos:

```bash
export SPRITE_STUDIO_ACCESS_KEY="<tu-clave>"
export SPRITE_FORGE_API="https://7ts10e4a78.execute-api.us-east-1.amazonaws.com"
```

## Crear una generación

`POST /sprite-studio/asset`

### Personaje por partes con perfil derecho

```bash
curl -X POST "$SPRITE_FORGE_API/sprite-studio/asset" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "'"$SPRITE_STUDIO_ACCESS_KEY"'",
    "description": "un guardián del bosque con espada y bufanda roja",
    "assetType": "character",
    "style": "bramblebound",
    "workflow": "parts",
    "direction": "right",
    "model": "gpt-image-2",
    "movements": ["idle", "walk", "run", "jump", "slash", "hurt", "death"]
  }'
```

También se puede enviar `referenceImage` como Data URL PNG/JPEG/WebP de hasta 4 MB. Es el camino
recomendado para mantener la identidad de un personaje ya creado.

Valores relevantes:

- `workflow`: `single`, `keyposes`, `parts`.
- `direction`: `front`, `right`, `left`.
- `model`: `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1-mini`.
- `movements`: ids de presets como `idle`, `walk`, `run`, `jump`, `slash`, `hurt`, `death`.

Respuesta `202`:

```json
{
  "jobId": "uuid",
  "status": "queued",
  "message": "Asset generation started."
}
```

## Consultar el trabajo

`GET /sprite-studio/asset/{jobId}?key=...`

```bash
curl "$SPRITE_FORGE_API/sprite-studio/asset/$JOB_ID?key=$SPRITE_STUDIO_ACCESS_KEY"
```

Respuesta lista para un atlas de partes:

```json
{
  "jobId": "uuid",
  "assetId": "uuid",
  "status": "ready",
  "model": "gpt-image-2",
  "workflow": "parts",
  "direction": "right",
  "imageUrl": "https://signed-s3-url...",
  "rigLayout": {
    "columns": 4,
    "rows": 3,
    "parts": [
      "head", "torso", "hips", "weapon",
      "leftUpperArm", "leftForearmHand", "rightUpperArm", "rightForearmHand",
      "leftUpperLeg", "leftLowerLegFoot", "rightUpperLeg", "rightLowerLegFoot"
    ]
  }
}
```

La URL es temporal; el asset permanece en S3 y puede recuperarse posteriormente desde la biblioteca.

## Integración automatizada

1. Envía la descripción o una `referenceImage` con `workflow: "parts"`.
2. Consulta el `jobId` hasta obtener `ready` o `failed`.
3. Descarga `imageUrl`.
4. Divide la imagen usando `rigLayout.columns`, `rows` y el orden indicado.
5. Quita el fondo claro y recorta el alpha de cada celda.
6. Construye la jerarquía documentada en `Portfolio-du/SPRITE_FORGE.md`.
7. Aplica los presets solicitados o abre el proyecto en Sprite Forge y exporta el ZIP para Godot.

El frontend implementa esta referencia en `src/lib/spriteStudio/rigParts.ts`; puede reutilizarse en una
automatización web sin depender de la interfaz visual.

## Biblioteca persistente

- `GET /sprite-studio/assets?key=...`: lista assets y rigs del propietario.
- `GET /sprite-studio/assets/{assetId}?key=...`: devuelve metadata y URL firmada.
- `POST /sprite-studio/assets`: guarda un `CharacterSpec` o `SpriteStudioProject` completo.

Los proyectos `rig-parts` incluyen las texturas recortadas, jerarquía, dirección y animaciones, por lo
que el JSON recuperado se puede volver a abrir y exportar sin repetir llamadas de imagen.

## Límites

- Descripción: 900 caracteres.
- Referencia: 4 MB, PNG/JPEG/WebP.
- Proyecto persistido: 6 MB serializado.
- El endpoint es asíncrono porque una generación de imagen puede superar el timeout HTTP de API Gateway.

