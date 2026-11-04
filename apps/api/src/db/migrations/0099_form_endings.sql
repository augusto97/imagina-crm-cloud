-- v0.1.356 — Formularios: pantallas finales.
--
-- Una respuesta que espera la confirmación del correo (doble opt-in) guarda
-- la pantalla final que le correspondió al enviarla, así la página de
-- «Confirmaste tu respuesta» muestra la misma (con las respuestas de quien
-- la mandó). null = el «¡Gracias!» de siempre.
ALTER TABLE "form_pending_submissions" ADD COLUMN IF NOT EXISTS "ending_id" varchar(24);
