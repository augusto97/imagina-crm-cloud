import { z } from 'zod';

/**
 * v0.1.465 — Zod 4 compila un validador rápido con `new Function` la
 * primera vez que arma un objeto, si el navegador lo permite. Nuestra CSP no
 * deja (`script-src` sin `'unsafe-eval'`): la prueba falla en silencio pero
 * el navegador igual registra una violación de la política. En el navegador
 * se apaga (`jitless`); en el servidor sí se usa.
 *
 * Tiene que ser el PRIMER import de cada entrada: Zod decide si compila al
 * ARMAR cada esquema, y los de `@imagina-base/shared` se arman al cargar.
 */
z.config({ jitless: true });
