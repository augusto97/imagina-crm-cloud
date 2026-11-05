-- v0.1.368 (ADR-S96) — Formularios que suscriben al enviar: con confirmación
-- por correo, el plan que eligió la persona espera con la respuesta pendiente
-- y la suscripción se arma recién al confirmar.

ALTER TABLE "form_pending_submissions" ADD COLUMN IF NOT EXISTS "plan_id" bigint;
