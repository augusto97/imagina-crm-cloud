-- v0.1.153 — El acceso al portal SÍ queda registrado (`portal_links` existe
-- desde F3), pero no había forma de verlo ni de saber si el cliente llegó a
-- entrar. Se guarda la última entrada para poder mostrarla y para que el admin
-- deje de re-tipear el email cada vez.
ALTER TABLE "portal_links" ADD COLUMN IF NOT EXISTS "last_access_at" timestamptz;
