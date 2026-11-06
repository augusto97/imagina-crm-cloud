-- v0.1.386 — De dónde llegó una respuesta que espera la confirmación por
-- correo (la página desde donde se envió, el sitio anterior y la campaña):
-- al confirmar, las automatizaciones «Cuando se envía un formulario» la usan
-- para `{{formulario.pagina}}` y el filtro «sólo si la página contiene…».
ALTER TABLE "form_pending_submissions" ADD COLUMN IF NOT EXISTS "origin" jsonb;
