import { Image as ImageIcon, Sparkles } from 'lucide-react';

import { At, C, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * La biblioteca de medios del sitio en una lista: la miniatura de cada
 * imagen, su texto alternativo (las que no tienen, vacías), dónde se usa y su
 * peso; la IA mira la imagen y propone el texto, que se copia al texto
 * alternativo y viaja a WordPress.
 */

const CSS = `
@keyframes sa-scan{0%,10%{opacity:0;transform:translateY(0)}14%{opacity:1}34%{opacity:1;transform:translateY(40px)}38%,100%{opacity:0;transform:translateY(40px)}}
@keyframes sa-ai1{0%,30%{opacity:0;transform:translateX(-4px)}36%,100%{opacity:1;transform:translateX(0)}}
@keyframes sa-ai2{0%,44%{opacity:0;transform:translateX(-4px)}50%,100%{opacity:1;transform:translateX(0)}}
@keyframes sa-old{0%,66%{opacity:1}70%,100%{opacity:0}}
@keyframes sa-new{0%,66%{opacity:0}70%,100%{opacity:1}}
@keyframes sa-badge{0%,76%{opacity:0;transform:scale(.8)}82%,100%{opacity:1;transform:scale(1)}}
`;

const COLS = '44px 1fr 1fr 0.8fr 0.5fr';

function Thumb({ t, glyph }: { t: 'blue' | 'mint' | 'amber' | 'violet'; glyph: number }): JSX.Element {
    return (
        <span style={{ position: 'relative', width: 40, height: 30, borderRadius: 5, overflow: 'hidden', background: tone(t, 0.75), display: 'block' }}>
            <span style={{ position: 'absolute', left: 6, bottom: 6, width: 14 + glyph * 4, height: 8, borderRadius: 2, background: 'rgba(255,255,255,.85)' }} />
            <span style={{ position: 'absolute', right: 6, top: 5, width: 7, height: 7, borderRadius: 99, background: 'rgba(255,255,255,.9)' }} />
        </span>
    );
}

const ROWS: Array<{ t: 'blue' | 'mint' | 'amber' | 'violet'; title: string; alt: string | null; ai: string; used: string; kb: string; heavy?: boolean; anim?: string }> = [
    { t: 'mint', title: 'Fachada de la casa', alt: 'Fachada blanca con jardín al frente', ai: '', used: 'Casa con jardín', kb: '180 KB' },
    { t: 'blue', title: 'Sala del apartamento', alt: null, ai: 'Sala luminosa con sofá gris y ventanal', used: '2 páginas', kb: '240 KB', anim: 'sa-ai1' },
    { t: 'amber', title: 'Vista del penthouse', alt: null, ai: 'Atardecer sobre la ciudad desde una terraza', used: '—', kb: '1,2 MB', heavy: true, anim: 'sa-ai2' },
];

export default function SitioAlt(): JSX.Element {
    return (
        <Stage
            label="La biblioteca de medios en una lista: miniatura, texto alternativo, dónde se usa y peso de cada imagen. La IA mira las imágenes sin texto alternativo y lo propone; copiado a la columna, viaja a WordPress."
            tint="mint"
        >
            <Keyframes css={CSS} />
            <Win x={12} y={14} w={456} h={196} title="Medios · WordPress">
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 8, height: 24, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    {['Imagen', 'Texto alternativo', 'Sugerido por la IA', 'Dónde se usa', 'Peso'].map((h, i) => (
                        <span key={h} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            {i === 0 && <ImageIcon size={9} color={C.mutedFg} />}
                            {i === 2 && <Sparkles size={9} color={primary()} />}
                            <T size={8} weight={700} color={C.mutedFg}>
                                {h}
                            </T>
                        </span>
                    ))}
                </div>
                {ROWS.map((r, i) => (
                    <div key={r.title} style={{ position: 'relative', display: 'grid', gridTemplateColumns: COLS, gap: 8, height: 48, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ position: 'relative' }}>
                            <Thumb t={r.t} glyph={i} />
                            {r.anim && <span data-a="" style={{ animationName: 'sa-scan', position: 'absolute', left: 0, top: -4, width: 40, height: 2, background: primary(), boxShadow: `0 0 6px ${primary()}`, opacity: 0 }} />}
                        </span>
                        <span style={{ position: 'relative', height: 30, display: 'block' }}>
                            {r.alt ? (
                                <T size={8} style={{ whiteSpace: 'normal' }}>
                                    {r.alt}
                                </T>
                            ) : (
                                <>
                                    <span data-a="" style={{ animationName: 'sa-old', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
                                        <span style={{ fontSize: 8, fontWeight: 600, color: C.destructive, background: tone('rose', 0.12), padding: '2px 6px', borderRadius: 4 }}>Sin texto alternativo</span>
                                    </span>
                                    <span data-a="" style={{ animationName: 'sa-new', position: 'absolute', inset: 0, opacity: 0, display: 'flex', alignItems: 'center' }}>
                                        <T size={8} weight={600} style={{ whiteSpace: 'normal' }}>
                                            {r.ai}
                                        </T>
                                    </span>
                                </>
                            )}
                        </span>
                        <span data-a={r.anim ? '' : undefined} style={{ animationName: r.anim, opacity: r.anim ? 0 : 1 }}>
                            <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                                {r.ai || '—'}
                            </T>
                        </span>
                        <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            {r.used}
                        </T>
                        <span style={{ fontSize: 8.5, fontWeight: 700, color: r.heavy ? C.destructive : C.fg }}>{r.kb}</span>
                    </div>
                ))}
            </Win>
            <At x={12} y={222} w={456} style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                {['Sin texto alternativo', 'Imágenes de más de 300 KB'].map((v) => (
                    <span key={v} style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 9px', borderRadius: 99, background: C.card, border: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={600}>
                            Vista: {v}
                        </T>
                    </span>
                ))}
            </At>
            <At x={12} y={256} w={456} a="sa-badge" style={{ opacity: 0, display: 'flex', justifyContent: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, padding: '0 10px', borderRadius: 99, background: tone('mint', 0.16), border: `1px solid ${tone('mint', 0.45)}` }}>
                    <T size={9} weight={700}>
                        Copiado al texto alternativo · viaja a WordPress
                    </T>
                </span>
            </At>
        </Stage>
    );
}
