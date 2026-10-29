import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ApplySiteKitInput, Field, FilterNode, Role, SiteKitResult } from '@imagina-base/shared';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { ViewsService } from '../views/views.service';
import { SiteSyncService } from './site-sync.service';

/**
 * Kits listos para usar sobre una lista del sitio (v0.1.334, ADR-S84): lo que
 * vende el complemento armado con UN botón, con piezas que ya existen en la
 * app (columnas del sitio, fórmulas, vistas, campos con IA). Idempotente: lo
 * que ya existe (un campo con el mismo nombre interno, una vista con el mismo
 * nombre) no se duplica.
 *
 *  - **Auditoría SEO**: trae el SEO (descripción, palabra clave y lo que ve
 *    Google), suma los largos con fórmulas y las vistas «Sin descripción»,
 *    «Título de más de 60 caracteres», «Descripción de más de 160» y «Sin
 *    palabra clave», y un campo con IA que propone la meta descripción. Se
 *    aplica con la edición en lote («Copiar de otra columna») y se deshace
 *    desde el historial.
 *  - **Texto alternativo**: en los medios, la vista «Sin texto alternativo» y
 *    un campo con IA que lo propone MIRANDO la imagen.
 */

const PROMPT_META =
    'Escribe una meta descripción para esta página: entre 140 y 155 caracteres, en el mismo idioma que el título, clara y que invite a hacer clic. Si hay palabra clave, inclúyela de forma natural. Devuelve sólo el texto, sin comillas.';
const PROMPT_ALT =
    'Escribe el texto alternativo de esta imagen: una frase de hasta 125 caracteres que describa lo que se ve, concreta y sin empezar con «Imagen de» ni «Foto de». Si el título da contexto (un producto, un lugar, una persona), úsalo. Devuelve sólo el texto, sin comillas.';

function group(children: FilterNode[]): FilterNode {
    return { type: 'group', logic: 'and', children };
}

@Injectable()
export class SiteKitsService {
    constructor(
        private readonly sync: SiteSyncService,
        private readonly fields: FieldsService,
        private readonly views: ViewsService,
        private readonly lists: ListsService,
    ) {}

    async apply(tenantId: number, userId: number, role: Role, connectionId: number, input: ApplySiteKitInput): Promise<SiteKitResult> {
        const kind = input.resource.startsWith('media:') ? 'media' : input.resource.startsWith('term:') ? 'taxonomy' : 'post_type';
        if (input.kit === 'alt_text' && kind !== 'media') {
            throw new BadRequestException({ code: 'site_kit_wrong_object', message: 'El kit de texto alternativo es para la biblioteca de medios.', data: { status: 400 } });
        }
        if (input.kit === 'seo_audit' && kind === 'media') {
            throw new BadRequestException({ code: 'site_kit_wrong_object', message: 'La auditoría SEO es para entradas, páginas, tipos de contenido y taxonomías.', data: { status: 400 } });
        }
        const wanted =
            input.kit === 'seo_audit'
                ? ['seo:description', 'seo:focus_keyword', 'seo:google_title', 'seo:google_description', ...(kind === 'post_type' ? ['excerpt'] : ['description'])]
                : ['thumbnail', 'alt_text', 'title'];
        const ensured = await this.sync.ensureColumns(tenantId, userId, role, connectionId, input.resource, wanted, input.kit === 'seo_audit' ? ['seo:description'] : ['alt_text']);
        if (input.kit === 'seo_audit' && (!ensured.plugin.installed || !ensured.plugin.seo)) {
            throw new BadRequestException({
                code: 'site_kit_needs_seo',
                message: ensured.plugin.installed
                    ? 'La auditoría SEO necesita un plugin de SEO activo en el sitio (Rank Math, Yoast SEO, SEOPress o All in One SEO).'
                    : 'La auditoría SEO necesita el complemento «Imagina Base Connector» activo en el sitio. Instálalo desde la página del sitio.',
                data: { status: 400 },
            });
        }
        const listId = ensured.settings.lists[input.resource];
        if (!listId) throw new NotFoundException({ code: 'site_object_not_found', message: 'Ese tipo de contenido no se sincroniza.', data: { status: 404 } });
        const map = ensured.settings.fields[input.resource] ?? {};
        const warnings: string[] = [];
        if (ensured.missing.length > 0) {
            const o = ensured.settings.objects[input.resource];
            warnings.push(`El sitio no ofrece ${ensured.missing.map((k) => `«${o?.columns.find((c) => c.key === k)?.label ?? k}»`).join(', ')}: esa parte del kit queda afuera.`);
        }
        const list = await this.lists.get(tenantId, String(listId));
        let current = await this.fields.listByListId(tenantId, listId);
        const made: Array<{ id: number; label: string }> = [];
        const ensureField = async (slug: string, create: () => Promise<Field>): Promise<Field> => {
            const hit = current.find((f) => f.slug === slug);
            if (hit) return hit;
            const f = await create();
            current = [...current, f];
            made.push({ id: f.id, label: f.label });
            return f;
        };
        const viewsBefore = await this.views.list(tenantId, String(listId));
        const madeViews: Array<{ id: number; name: string }> = [];
        const ensureView = async (name: string, filter: FilterNode): Promise<void> => {
            if (viewsBefore.some((v) => v.name === name)) return;
            const v = await this.views.create(tenantId, String(listId), { name, type: 'table', config: { filter_tree: filter }, icon: input.kit === 'seo_audit' ? 'magnifying_glass' : 'image' });
            madeViews.push({ id: v.id, name: v.name });
        };

        if (input.kit === 'seo_audit') {
            const desc = map['seo:description'];
            const kw = map['seo:focus_keyword'];
            const gTitle = map['seo:google_title'];
            const gDesc = map['seo:google_description'];
            const title = map[kind === 'taxonomy' ? 'name' : 'title'];
            const summary = map[kind === 'post_type' ? 'excerpt' : 'description'];
            let titleLen: Field | null = null;
            let descLen: Field | null = null;
            if (gTitle) {
                titleLen = await ensureField('largo_titulo_google', () =>
                    this.fields.create(tenantId, String(listId), {
                        label: 'Largo del título en Google',
                        slug: 'largo_titulo_google',
                        type: 'formula',
                        config: { formula: `LARGO({#${gTitle}})`, result_type: 'number', precision: 0 },
                        description: 'Cuántos caracteres tiene el título que ve Google. Más de 60 se suele cortar en los resultados.',
                    }),
                );
            }
            if (gDesc) {
                descLen = await ensureField('largo_descripcion_google', () =>
                    this.fields.create(tenantId, String(listId), {
                        label: 'Largo de la descripción en Google',
                        slug: 'largo_descripcion_google',
                        type: 'formula',
                        config: { formula: `LARGO({#${gDesc}})`, result_type: 'number', precision: 0 },
                        description: 'Cuántos caracteres tiene la descripción que ve Google. Lo ideal: entre 120 y 160.',
                    }),
                );
            }
            const inputs = [title, kw, summary, gTitle].filter((x): x is number => typeof x === 'number');
            await ensureField('meta_descripcion_sugerida', () =>
                this.fields.create(tenantId, String(listId), {
                    label: 'Meta descripción sugerida',
                    slug: 'meta_descripcion_sugerida',
                    type: 'ai',
                    config: { task: 'custom', inputs, prompt: PROMPT_META, length: 'short', auto: false, quality: 'fast' },
                    description: 'Una propuesta de la IA. Para usarla, elige las filas y, en «Editar en lote», copia esta columna en «Descripción SEO» (se puede deshacer).',
                }),
            );
            if (desc) await ensureView('Sin descripción', group([{ type: 'condition', field_id: desc, op: 'is_null' }]));
            if (titleLen) await ensureView('Título de más de 60 caracteres', group([{ type: 'condition', field_id: titleLen.id, op: 'gt', value: 60 }]));
            if (descLen) await ensureView('Descripción de más de 160 caracteres', group([{ type: 'condition', field_id: descLen.id, op: 'gt', value: 160 }]));
            if (kw) await ensureView('Sin palabra clave', group([{ type: 'condition', field_id: kw, op: 'is_null' }]));
        } else {
            const thumb = map.thumbnail;
            const alt = map.alt_text;
            const title = map.title;
            if (!thumb) warnings.push('Sin la columna «Imagen» la IA no tiene qué mirar.');
            await ensureField('texto_alternativo_sugerido', () =>
                this.fields.create(tenantId, String(listId), {
                    label: 'Texto alternativo sugerido',
                    slug: 'texto_alternativo_sugerido',
                    type: 'ai',
                    config: { task: 'custom', inputs: [thumb, title].filter((x): x is number => typeof x === 'number'), prompt: PROMPT_ALT, length: 'short', auto: false, quality: 'fast' },
                    description: 'Una propuesta de la IA mirando la imagen. Para usarla, elige las filas y, en «Editar en lote», copia esta columna en «Texto alternativo» (se puede deshacer).',
                }),
            );
            if (alt) await ensureView('Sin texto alternativo', group([{ type: 'condition', field_id: alt, op: 'is_null' }]));
            const size = map.filesize;
            if (size) await ensureView('Imágenes de más de 300 KB', group([{ type: 'condition', field_id: size, op: 'gt', value: 300 }]));
        }
        return {
            list: { id: list.id, slug: list.slug, name: list.name },
            views: madeViews,
            fields: made,
            added_columns: ensured.added,
            warnings,
        };
    }
}
