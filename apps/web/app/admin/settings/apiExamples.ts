/**
 * v0.1.441 (G1) — Ejemplos listos para copiar de Ajustes → API. Puro: arma el
 * texto con la dirección real de la API y el token (o un marcador mientras no
 * se creó uno). Los valores van en `data` con la clave `f{id}` del campo.
 */
export interface ApiExample {
    key: string;
    label: string;
    text: string;
}

export function apiExamples(base: string, token: string): ApiExample[] {
    const auth = `-H "Authorization: Bearer ${token}"`;
    return [
        { key: 'whoami', label: '¿Quién soy? (prueba el token)', text: `curl ${auth} \\\n  ${base}/whoami` },
        { key: 'lists', label: 'Tus listas', text: `curl ${auth} \\\n  ${base}/lists` },
        { key: 'fields', label: 'Los campos de una lista (con su id)', text: `curl ${auth} \\\n  ${base}/lists/<lista>/fields` },
        {
            key: 'records',
            label: 'Registros de una lista (50 por página)',
            text: `curl ${auth} \\\n  "${base}/lists/<lista>/records?limit=50"`,
        },
        {
            key: 'create',
            label: 'Crear un registro',
            text: `curl -X POST ${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '{"data":{"f12":"Ana Gómez","f13":"ana@ejemplo.com"}}' \\\n  ${base}/lists/<lista>/records`,
        },
        {
            key: 'update',
            label: 'Cambiar un registro (sólo lo que mandas)',
            text: `curl -X PATCH ${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '{"data":{"f14":"cliente"}}' \\\n  ${base}/lists/<lista>/records/<id>`,
        },
    ];
}
