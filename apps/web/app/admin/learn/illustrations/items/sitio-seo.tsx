import { Sparkles } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Auditoría SEO: la lista de entradas con el largo del título que ve Google
 * (rojo pasados los 60), la vista «Sin descripción», la columna con IA que
 * propone la meta descripción y «Editar en lote → Copiar de otra columna» que
 * la pasa a «Descripción SEO» (y viaja a WordPress).
 */

const CSS = `
@keyframes ss-cur{0%{transform:translate(250px,290px);opacity:0}6%{opacity:1}12%,18%{transform:translate(150px,40px)}40%,46%{transform:translate(360px,118px)}66%,72%{transform:translate(398px,262px)}90%,100%{transform:translate(440px,290px);opacity:0}}
@keyframes ss-ring{0%,14%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1)}19%{opacity:0;transform:scale(1.6)}42%{opacity:0;transform:scale(.4)}43%{opacity:1;transform:scale(1)}47%{opacity:0;transform:scale(1.6)}68%{opacity:0;transform:scale(.4)}69%{opacity:1;transform:scale(1)}73%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ss-tab{0%,16%{background:transparent;color:${C.mutedFg}}19%,100%{background:${primary(0.1)};color:${primary()}}}
@keyframes ss-ai{0%,30%{opacity:0}36%,100%{opacity:1}}
@keyframes ss-sel{0%,44%{background:transparent}47%,100%{background:${primary(0.07)}}}
@keyframes ss-old{0%,72%{opacity:1}75%,100%{opacity:0}}
@keyframes ss-new{0%,72%{opacity:0}75%,100%{opacity:1}}
@keyframes ss-pop{0%,48%{opacity:0;transform:translateY(6px)}52%,74%{opacity:1;transform:translateY(0)}78%,100%{opacity:0}}
`;

const COLS = '1.3fr 0.45fr 1.2fr 1.4fr';
const ROWS: Array<[string, number, string]> = [
    ['Cómo elegir un apartamento en Medellín', 72, 'Guía para elegir apartamento en Medellín: zonas, precios y qué revisar antes de firmar.'],
    ['Checklist de mudanza', 41, 'La lista para mudarte sin olvidar nada: cajas, servicios, papeles y el día de la entrega.'],
    ['Abrimos oficina en el norte', 46, 'Nueva oficina en el norte de la ciudad: horarios, cómo llegar y quién te atiende.'],
];

export default function SitioSeo(): JSX.Element {
    return (
        <Stage
            label="La auditoría SEO en la lista de entradas: el largo del título en rojo cuando pasa de 60 caracteres, la vista Sin descripción, la columna con IA que propone la descripción y la edición en lote que la copia a Descripción SEO."
            tint="violet"
        >
            <Keyframes css={CSS} />
            <Win x={12} y={12} w={456} h={232} title="Entradas · WordPress">
                <div style={{ display: 'flex', gap: 4, padding: '6px 10px', borderBottom: `1px solid ${C.border}` }}>
                    {['Todos', 'Sin descripción', 'Título de más de 60', 'Sin palabra clave'].map((v, i) => (
                        <span
                            key={v}
                            data-a={i === 1 ? '' : undefined}
                            style={{ animationName: i === 1 ? 'ss-tab' : undefined, fontSize: 8.5, fontWeight: 600, padding: '3px 7px', borderRadius: 6, color: i === 0 ? C.fg : C.mutedFg }}
                        >
                            {v}
                        </span>
                    ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 24, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    {['Título en Google', 'Largo', 'Descripción SEO', 'Sugerida por la IA'].map((h, i) => (
                        <span key={h} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            {i === 3 && <Sparkles size={9} color={primary()} />}
                            <T size={8} weight={700} color={C.mutedFg}>
                                {h}
                            </T>
                        </span>
                    ))}
                </div>
                {ROWS.map(([title, len, ai]) => (
                    <div key={title} data-a="" style={{ animationName: 'ss-sel', display: 'grid', gridTemplateColumns: COLS, gap: 6, minHeight: 44, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={600} style={{ whiteSpace: 'normal' }}>
                            {title}
                        </T>
                        <span style={{ display: 'inline-flex', justifyContent: 'center', minWidth: 26, height: 16, alignItems: 'center', borderRadius: 4, fontSize: 8.5, fontWeight: 700, color: len > 60 ? C.destructive : C.fg, background: len > 60 ? tone('rose', 0.14) : 'transparent' }}>
                            {len}
                        </span>
                        <span style={{ position: 'relative', minHeight: 34, display: 'block' }}>
                            <span data-a="" style={{ animationName: 'ss-old', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
                                <T size={8.5} color={C.mutedFg}>
                                    —
                                </T>
                            </span>
                            <span data-a="" style={{ animationName: 'ss-new', position: 'absolute', inset: 0, opacity: 0, display: 'flex', alignItems: 'center' }}>
                                <T size={7.5} style={{ whiteSpace: 'normal' }}>
                                    {ai}
                                </T>
                            </span>
                        </span>
                        <span data-a="" style={{ animationName: 'ss-ai', opacity: 0 }}>
                            <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                                {ai}
                            </T>
                        </span>
                    </div>
                ))}
            </Win>

            <At x={226} y={252} w={242} a="ss-pop" style={{ opacity: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 9px', boxShadow: '0 10px 22px -12px rgba(15,23,42,.5)', zIndex: 5 }}>
                <T size={8.5} weight={700}>
                    Editar en lote
                </T>
                <T size={8} color={C.mutedFg} style={{ display: 'block', marginTop: 2 }}>
                    Descripción SEO → Copiar de otra columna → Sugerida por la IA
                </T>
            </At>
            <At x={12} y={256} w={200} style={{ display: 'flex', alignItems: 'center' }}>
                <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                    El cambio viaja a WordPress y se puede deshacer.
                </T>
            </At>
            <Cursor a="ss-cur" click="ss-ring" />
        </Stage>
    );
}
