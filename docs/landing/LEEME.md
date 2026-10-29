# Kit de landing — Imagina Base (imagina.cloud/base)

Todo lo necesario para que Claude Design diseñe la landing y para publicarla en WordPress
bien posicionada.

## Qué hay en la carpeta

| Archivo / carpeta | Para qué sirve |
|---|---|
| `01-PROMPT-CLAUDE-DESIGN.md` | **Empieza aquí.** Pasos, qué archivos subir, el prompt principal para pegar y 7 prompts de seguimiento |
| `02-TEXTOS-LANDING.md` | Todos los textos de la página, sección por sección, listos para usar (y preguntas frecuentes) |
| `03-SEO.md` | Título, meta descripción, encabezados, JSON-LD, palabras clave, arquitectura del sitio, las primeras 15 páginas, SEO técnico en WordPress y visibilidad en las IA |
| `04-MOTION.md` | Dirección de animaciones: 15 ideas, tiempos, curvas, rendimiento y accesibilidad, y qué video usar en cada sección |
| `05-COMPETENCIA.md` | Cómo venden ClickUp, Airtable, monday, Notion, HubSpot, Pipedrive, Bitrix24 y otros, y la oportunidad que dejan |
| `06-CAPTURAS-Y-VIDEOS.md` | Índice de cada captura y video, y dónde usarlo |
| `capturas/escritorio/` | 27 capturas reales de la app (2880×1800) |
| `capturas/oscuro/` | 6 capturas en modo oscuro |
| `capturas/celular/` | 8 capturas de celular (1170×2532) |
| `motion/animaciones/` | 18 animaciones de la marca (MP4 + WebM, loops de 7 s) |
| `motion/app/` | Clips de la app en uso con cursor (MP4 + WebM) |
| `marca/` | Logo (claro y oscuro) e ícono, del servidor de producción |

## Decisiones ya tomadas (están en los textos)

- **Prueba gratis de 15 días, sin tarjeta.** Durante la prueba: 500 registros, 3 personas y
  3 automatizaciones.
- **Precios:** Starter $59.000 COP / US$15 y Pro $199.000 COP / US$49 al mes, por empresa
  (los vas a ajustar: cámbialos en Plataforma → Planes y en `02-TEXTOS-LANDING.md`).
- **Asistente IA y soporte en español: solo en los planes de pago.** Los textos lo dicen
  así, sin esconderlo.
- **Importador de Excel casi automático:** es el camino principal de «Cómo empiezas».

## Antes de publicar, confirma

Busca **[CONFIRMAR]** en `02-TEXTOS-LANDING.md`:
1. **Medios de pago activos** (Plataforma → Cobros): PSE, Nequi, tarjeta y efectivo
   dependen de tener Mercado Pago configurado; dólares, de PayPal.
2. **Redes sociales** del pie y del JSON-LD (LinkedIn, YouTube, Instagram…).

## Tareas en la app y en el sitio

1. **Plataforma → Marca → «Sitio del producto»** = `https://imagina.cloud/base` (aparece
   «Conoce Imagina Base» en el login).
2. Botones del sitio a
   `https://base.imagina.cloud/registro?utm_source=sitio&utm_medium=landing&utm_campaign=<seccion>`
   (la consola muestra «Desde sitio» en cada alta).
3. **Plataforma → Planes → Trial:** pon «IA/mes» en **0** para que la IA quede solo en los
   planes de pago (hoy la semilla le da 20). Ojo: con 0, la opción «Cuéntanos de tu
   negocio» de la bienvenida aparece deshabilitada en la prueba; quedan las plantillas y
   el Excel, que es justo lo que la landing promete.
4. **Los 15 días todavía no los aplica la app:** hoy el plan Trial no vence. Hasta que se
   implemente el vencimiento, la prueba sigue abierta (ver el hilo en `CONTINUIDAD.md`).
5. **El día del lanzamiento**, abre el sitio a los buscadores: checklist en `03-SEO.md`,
   sección 6 (hoy está cerrado a propósito).
