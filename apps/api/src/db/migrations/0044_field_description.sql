-- v0.1.163 — Descripción por campo ("Diles a otros usuarios cómo usar este
-- campo", como el administrador de campos de ClickUp). Es metadata pura: se
-- muestra como ayuda bajo el campo en los formularios y en el administrador.
-- No participa de la validación ni de los datos del registro.
ALTER TABLE "fields" ADD COLUMN IF NOT EXISTS "description" text;
