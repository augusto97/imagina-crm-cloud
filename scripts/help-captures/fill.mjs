/**
 * Datos de ejemplo creíbles para las capturas: completa cada lista de la
 * empresa de ejemplo hasta ~N registros con valores según el tipo de cada
 * campo (nombres, montos, fechas repartidas alrededor de hoy, opciones,
 * vínculos a otras listas). Determinista: la misma semilla da los mismos
 * datos, así dos corridas del release se ven iguales.
 */

let seed = 20261027;
function rnd() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => Math.round(a + rnd() * (b - a));

const PEOPLE = ['Ana Gómez', 'Carlos Ruiz', 'Lucía Martínez', 'Jorge Herrera', 'Valentina Ríos', 'Andrés Mejía', 'Camila Torres', 'Felipe Vargas', 'Sofía Cárdenas', 'Mateo Castro', 'Isabella Rojas', 'Daniel Ospina', 'Mariana López', 'Santiago Pérez', 'Paula Restrepo', 'Juan Pablo Díaz', 'Laura Moreno', 'Sebastián Gil'];
const COMPANIES = ['Café Bahía', 'Hotel Brisas del Mar', 'Clínica Norte', 'Ferretería El Sol', 'Colegio Andino', 'Óptica Visión', 'Panadería La Espiga', 'Constructora Altos', 'Agencia Rumbo', 'Distribuidora Oriente', 'Gimnasio Fénix', 'Restaurante Cúrcuma', 'Inmobiliaria Prado', 'Taller Motoexpress', 'Veterinaria Huellitas', 'Floristería Jazmín', 'Librería Papiro', 'Lavandería Burbujas'];
const TASKS = ['Preparar propuesta comercial', 'Revisar contrato con el proveedor', 'Diseñar campaña de fin de año', 'Llamar a clientes con saldo', 'Actualizar catálogo de productos', 'Planear capacitación del equipo', 'Cerrar inventario del mes', 'Responder encuesta de satisfacción', 'Migrar datos al nuevo sistema', 'Reunión de seguimiento semanal', 'Publicar ofertas en redes', 'Auditar facturas pendientes', 'Organizar evento de lanzamiento', 'Renovar dominio y hosting'];
const TICKETS = ['No puedo entrar a mi cuenta', 'Error al descargar la factura', 'Cambio de dirección de envío', 'El pedido llegó incompleto', 'Solicitud de devolución', 'Duda sobre el plan anual', 'La app no carga en el celular', 'Necesito una copia del contrato', 'Cobro duplicado en la tarjeta', 'Quiero cambiar de plan'];
const PRODUCTS = ['Café de origen 500 g', 'Taza de cerámica', 'Prensa francesa', 'Molino manual', 'Filtros de papel x100', 'Termo de acero', 'Kit de barista', 'Café descafeinado 250 g', 'Jarra para leche', 'Báscula digital'];
const DEALS = ['Plan anual', 'Renovación de contrato', 'Proyecto web', 'Capacitación', 'Licencias adicionales', 'Consultoría', 'Mantenimiento', 'Ampliación de sede'];

function titleFor(listName, i) {
    const n = listName.toLowerCase();
    if (n.includes('cliente') || n.includes('proveedor') || n.includes('empresa')) return COMPANIES[i % COMPANIES.length];
    if (n.includes('oportunidad') || n.includes('negocio')) return `${pick(DEALS)} · ${COMPANIES[i % COMPANIES.length]}`;
    if (n.includes('factura')) return `FAC-${String(1040 + i).padStart(4, '0')}`;
    if (n.includes('tarea') || n.includes('proyecto')) return TASKS[i % TASKS.length];
    if (n.includes('ticket') || n.includes('caso')) return TICKETS[i % TICKETS.length];
    if (n.includes('producto') || n.includes('inventario')) return PRODUCTS[i % PRODUCTS.length];
    if (n.includes('cita')) return `Cita · ${PEOPLE[i % PEOPLE.length]}`;
    return PEOPLE[i % PEOPLE.length];
}

const iso = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d;
};

const SKIP = new Set(['computed', 'lookup', 'rollup', 'formula', 'autonumber', 'created_at', 'updated_at', 'created_by', 'updated_by', 'ai', 'button', 'file', 'approval', 'time_tracked', 'checklist_progress']);

function valueFor(field, listName, i, ctx) {
    const label = String(field.label ?? '').toLowerCase();
    const opts = field.config?.options ?? [];
    switch (field.type) {
        case 'text':
            if (field.is_primary) return titleFor(listName, i);
            if (label.includes('nit') || label.includes('documento') || label.includes('cédula')) return String(between(800000000, 999999999));
            if (label.includes('ciudad')) return pick(['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Bucaramanga', 'Pereira']);
            if (label.includes('contacto') || label.includes('nombre') || label.includes('responsable')) return pick(PEOPLE);
            if (label.includes('sku') || label.includes('código')) return `SKU-${between(1000, 9999)}`;
            return null;
        case 'long_text':
            return label.includes('nota') || label.includes('descripción') || label.includes('detalle') ? 'Cliente frecuente. Prefiere que lo contacten por WhatsApp en la mañana.' : null;
        case 'email': {
            const who = pick(PEOPLE).split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
            return `${who}${between(1, 99)}@ejemplo.com`;
        }
        case 'phone':
            return `+573${between(10, 22)}${between(1000000, 9999999)}`;
        case 'url':
            return null;
        case 'number':
            return label.includes('stock') || label.includes('cantidad') ? between(0, 80) : between(1, 40);
        case 'currency':
            return label.includes('precio') || label.includes('costo') ? between(12, 180) * 1000 : between(15, 480) * 10000;
        case 'percent':
            return between(0, 10) * 10;
        case 'rating':
            return between(3, 5);
        case 'duration':
            return between(2, 16) * 15;
        case 'checkbox':
            return rnd() > 0.5;
        case 'date':
            return iso(daysFromNow(between(-25, 35)));
        case 'datetime': {
            const d = daysFromNow(between(-3, 14));
            d.setUTCHours(between(13, 22), pick([0, 30]), 0, 0); // 8:00–17:30 en Bogotá
            return d.toISOString();
        }
        case 'select':
            return opts.length ? opts[Math.min(opts.length - 1, Math.floor(Math.pow(rnd(), 1.4) * opts.length))].value : null;
        case 'multi_select':
            return opts.length ? [...new Set([pick(opts).value, ...(rnd() > 0.6 ? [pick(opts).value] : [])])] : null;
        case 'user':
            return ctx.userId;
        case 'relation': {
            const pool = ctx.recordIdsByList.get(field.config?.target_list_id);
            return pool?.length ? [pool[i % pool.length]] : null;
        }
        default:
            return null;
    }
}

/** Completa las listas de la empresa hasta `target` registros cada una. */
export async function fillLists(api, userId, target = 16) {
    const { data: lists } = await api.get('/lists');
    const recordIdsByList = new Map();
    // Primero las listas «de base» (clientes, productos): otras las vinculan.
    const order = [...lists].sort((a, b) => score(b.name) - score(a.name));
    for (const list of order) {
        const { data: fields } = await api.get(`/lists/${list.slug}/fields`);
        const existing = await api.get(`/lists/${list.slug}/records?limit=200`);
        const ids = (existing.data ?? []).map((r) => r.id);
        const missing = Math.max(0, target - ids.length);
        if (missing > 0) {
            const items = [];
            for (let i = ids.length; i < ids.length + missing; i++) {
                const data = {};
                for (const f of fields) {
                    if (SKIP.has(f.type)) continue;
                    const v = valueFor(f, list.name, i, { userId, recordIdsByList });
                    if (v !== null && v !== undefined) data[`f${f.id}`] = v;
                }
                items.push({ data });
            }
            try {
                const res = await api.post(`/lists/${list.slug}/records/batch`, { items });
                for (const c of res.created ?? []) if (c?.record?.id) ids.push(c.record.id);
                if (res.failed?.length) console.log(`  «${list.name}»: ${res.failed.length} filas rechazadas (${res.failed[0].message})`);
                console.log(`  «${list.name}»: +${items.length} registros`);
            } catch (e) {
                console.log(`  «${list.name}»: no se pudo completar (${e.message.slice(0, 160)})`);
            }
        }
        recordIdsByList.set(list.id, ids);
    }
}

function score(name) {
    const n = name.toLowerCase();
    if (n.includes('cliente') || n.includes('producto') || n.includes('proveedor')) return 2;
    return 0;
}
