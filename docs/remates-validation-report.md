# Remates Ecuador - reporte de validación BIESS

Ejecución local headed: 7 de agosto de 2026.

## Cobertura observada

| Oficina | Páginas con datos | Página vacía | IDs únicos |
|---|---:|---:|---:|
| Quito (`15`) | 7 | 8 | 38 |
| Guayaquil (`16`) | 5 | 6 | 27 |
| Total | 12 | 2 | 65 |

Se descargaron 10/10 extractos solicitados. Todos comenzaron con cabecera `%PDF`. El conjunto local ocupó aproximadamente 8 MB. Los binarios quedan fuera de Git; se pueden regenerar con el script oficial del proyecto.

## Muestra descargada

| ID | PDF | Texto nativo | Nota |
|---|---|---:|---|
| BIESS-UIO-2026-0110 | Sí | No | Caso de contradicción; validación visual de 2 páginas |
| BIESS-UIO-2026-0111 | Sí | Por validar | 2 páginas |
| BIESS-UIO-2026-0120 | Sí | Por validar | Nombre declara segundo señalamiento |
| BIESS-UIO-2026-0130 | Sí | Por validar | Nombre declara segundo señalamiento |
| BIESS-UIO-2026-0091 | Sí | Por validar | 2 páginas |
| BIESS-UIO-2026-0107 | Sí | Por validar | 1 página |
| BIESS-UIO-2026-0142 | Sí | Por validar | Nombre declara tercer señalamiento |
| BIESS-UIO-2026-0140 | Sí | Por validar | Nombre declara tercer señalamiento |
| BIESS-UIO-2026-0144 | Sí | Por validar | 2 páginas |
| BIESS-UIO-2026-0145 | Sí | Por validar | 1 página |

## Validación humana de BIESS-UIO-2026-0110

| Campo | Ficha web | PDF oficial | Resultado normalizado | Correcto |
|---|---|---|---|---|
| Señalamiento | PRIMERO | TERCERO | 3, documento oficial | Sí |
| Avalúo | 251.967,44 | 251.967,44 | 251967.44 | Sí |
| Base | No visible | 125.983,72 | 125983.72 | Sí |
| Propiedad | No precisa | Apartamento + parqueadero + bodega con alícuotas PH | 100%, propiedad horizontal | Sí |
| Fecha del remate | No verificada en card | 17/08/2026 | 2026-08-17 | Sí |
| Dirección | No visible en card | Pasaje E16A N39-54 y Guangüiltagua, Jardines del Batán | Dirección textual; sin coordenadas inventadas | Sí |

## Problemas encontrados

1. El contador del paginador está desactualizado y conduce a docenas de páginas vacías.
2. Existen IDs duplicados entre páginas.
3. El enlace al PDF no es un URL: requiere sesión JSF y POST.
4. El detalle web puede contradecir el PDF.
5. Algunos PDFs son escaneados; extracción de texto directa devuelve vacío.
6. Nombres de archivo llegan con mojibake en ciertos encabezados; el almacenamiento usa ID + SHA-256 y no depende del nombre.

## Siguiente validación

Ejecutar Structured Outputs sobre las 10 muestras, comparar contra el documento renderizado y completar las columnas de señalamiento, base, propiedad y fecha antes de subir el límite semanal de extracciones. Luego repetir el protocolo de investigación en SRI, Consejo de la Judicatura y CFN.
