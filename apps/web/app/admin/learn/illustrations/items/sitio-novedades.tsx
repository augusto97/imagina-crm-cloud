import { FileText, Plus, Sparkles } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary } from '../kit';

/**
 * Novedades del sitio: aparece un campo nuevo de ACF y un tipo de contenido
 * nuevo en WordPress; la página del sitio los avisa y «Traer» suma la columna
 * a la lista, ya llena con lo que tiene el sitio.
 */

const CSS = `
@keyframes sn-cur{0%{transform:translate(250px,290px);opacity:0}6%{opacity:1}24%,30%{transform:translate(386px,132px)}56%,100%{transform:translate(430px,286px);opacity:0}}
@keyframes sn-ring{0%,28%{opacity:0;transform:scale(.4)}29%{opacity:1;transform:scale(1)}33%,100%{opacity:0;transform:scale(1.6)}}
@keyframes sn-colrow{0%,32%{opacity:1;max-height:30px}38%,100%{opacity:0;max-height:0}}
@keyframes sn-head{0%,40%{opacity:0;max-width:0}48%,100%{opacity:1;max-width:80px}}
@keyframes sn-cell{0%,46%{opacity:0}54%,100%{opacity:1}}
@keyframes sn-card{0%{opacity:0;transform:translateY(6px)}8%,100%{opacity:1;transform:translateY(0)}}
`;

function Item({ icon, title, kind, button, a }: { icon: JSX.Element; title: string; kind: string; button: string; a?: string }): JSX.Element {
    return (
        <div
            data-a={a ? '' : undefined}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 28,
                padding: '0 8px',
                borderRadius: 6,
                background: C.card,
                overflow: 'hidden',
                ...(a ? { animationName: a } : null),
            }}
        >
            {icon}
            <T size={8.5} weight={700}>
                {title}
            </T>
            <T size={7.5} color={C.mutedFg}>
                {kind}
            </T>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3, height: 18, padding: '0 8px', borderRadius: 5, background: primary(), color: '#fff', fontSize: 8, fontWeight: 600 }}>
                <Plus size={8} /> {button}
            </span>
            <T size={8} color={C.mutedFg}>
                Ya lo vi
            </T>
        </div>
    );
}

export default function SitioNovedades(): JSX.Element {
    const rows: Array<[string, string, string]> = [
        ['Casa en El Poblado', '$860 M', '180 m²'],
        ['Apartamento Laureles', '$420 M', '72 m²'],
        ['Finca en Rionegro', '$1.200 M', '640 m²'],
    ];
    return (
        <Stage
            label="Alguien creó en WordPress un campo nuevo, Metraje, y un tipo de contenido nuevo, Proyectos. La página del sitio los muestra como novedades y, al tocar Traer, la columna Metraje aparece en la lista ya llena con lo que tiene el sitio."
            tint="blue"
        >
            <Keyframes css={CSS} />

            <At x={16} y={12} w={448} a="sn-card" style={{ borderRadius: 10, border: `1px solid ${primary(0.4)}`, background: primary(0.06), padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Sparkles size={11} color={primary()} />
                    <T size={9.5} weight={700}>
                        Novedades en tu sitio
                    </T>
                </span>
                <Item icon={<FileText size={10} color={C.mutedFg} />} title="Proyectos" kind="Tipo de contenido nuevo" button="Traerlo" />
                <Item icon={<span style={{ width: 10 }} />} title="Metraje" kind="Campo de ACF · Propiedades" button="Traer" a="sn-colrow" />
            </At>

            <Win x={16} y={128} w={448} h={140} title="Propiedades">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 22, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ width: 150 }}>
                        <T size={8} weight={700} color={C.mutedFg}>
                            Título
                        </T>
                    </span>
                    <span style={{ width: 80 }}>
                        <T size={8} weight={700} color={C.mutedFg}>
                            Precio
                        </T>
                    </span>
                    <span data-a="" style={{ animationName: 'sn-head', overflow: 'hidden', whiteSpace: 'nowrap', opacity: 0, padding: '1px 5px', borderRadius: 4, background: primary(0.1) }}>
                        <T size={8} weight={700} color={primary()}>
                            Metraje
                        </T>
                    </span>
                </div>
                {rows.map(([t, p, m]) => (
                    <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 150 }}>
                            <T size={8.5} weight={600}>
                                {t}
                            </T>
                        </span>
                        <span style={{ width: 80 }}>
                            <T size={8.5}>{p}</T>
                        </span>
                        <span data-a="" style={{ animationName: 'sn-cell', opacity: 0, paddingLeft: 5 }}>
                            <T size={8.5}>{m}</T>
                        </span>
                    </div>
                ))}
            </Win>

            <At x={16} y={276} w={448} style={{ display: 'flex', justifyContent: 'center' }}>
                <T size={8.5} color={C.mutedFg}>
                    Lo que ya decidiste no traer no vuelve a aparecer como novedad.
                </T>
            </At>

            <Cursor a="sn-cur" click="sn-ring" />
        </Stage>
    );
}
