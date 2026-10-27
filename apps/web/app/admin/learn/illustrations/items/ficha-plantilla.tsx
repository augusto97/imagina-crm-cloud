import { BookmarkPlus, CalendarDays, ChevronDown, CornerDownRight, ListChecks, Plus, User } from 'lucide-react';

import { At, Avatar, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/** Plantillas de registro: «Nuevo registro ▾ → Desde una plantilla» y el registro nace con fechas, subtareas y checklist. */

const CSS = `
@keyframes fpl-menu{0%,14%{opacity:0;transform:translateY(-4px)}18%,36%{opacity:1;transform:translateY(0)}39%,100%{opacity:0}}
@keyframes fpl-hl{0%,25%{transform:translateY(0)}29%,100%{transform:translateY(24px)}}
@keyframes fpl-card{0%,38%{opacity:0;transform:translateY(12px)}44%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
${[0, 1, 2, 3].map((i) => `@keyframes fpl-s${i}{0%,${48 + i * 6}%{opacity:0;transform:translateX(-6px)}${52 + i * 6}%,94%{opacity:1;transform:translateX(0)}99%,100%{opacity:0}}`).join('\n')}
@keyframes fpl-cur{0%{transform:translate(200px,290px);opacity:0}5%{opacity:1}11%,15%{transform:translate(447px,32px)}26%,32%{transform:translate(390px,104px);opacity:1}48%,100%{transform:translate(460px,250px);opacity:0}}
@keyframes fpl-ring{0%,13%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1)}17%,30%{opacity:0;transform:scale(1.6)}31%{opacity:1;transform:scale(1)}34%,100%{opacity:0;transform:scale(1.6)}}
`;

const TEMPLATES = ['Alta de cliente', 'Proyecto de página web', 'Caso de soporte'];
const SUBS = ['Brief y contenidos', 'Diseño de la portada', 'Desarrollo y pruebas'];

export default function FichaPlantilla(): JSX.Element {
    return (
        <Stage label="En la lista de proyectos se abre «Nuevo registro», el menú «Desde una plantilla» y se elige «Proyecto de página web». El registro nuevo nace con su estado, la fecha de entrega calculada en días hábiles, el responsable, tres subtareas y un checklist." tint="violet">
            <Keyframes css={CSS} />
            {/* Cabecera de la lista */}
            <At x={16} y={14} w={448} h={36} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8 }}>
                <T size={11} weight={700}>
                    Proyectos
                </T>
                <span style={{ width: 90, height: 18, borderRadius: 6, border: `1px solid ${C.border}` }} />
                <span style={{ flex: 1 }} />
                <span style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', background: primary(), color: C.primaryFg }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, height: 24, padding: '0 9px', fontSize: 9.5, fontWeight: 600 }}>
                        <Plus size={10} />
                        Nuevo registro
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', padding: '0 5px', borderLeft: `1px solid ${C.primaryFg}`, opacity: 0.9 }}>
                        <ChevronDown size={10} />
                    </span>
                </span>
            </At>
            {/* Filas de fondo */}
            <At x={16} y={58} w={448} h={228} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 12px', display: 'flex', flexDirection: 'column' }}>
                {['Tienda online Café Origen', 'Página de la clínica', 'Rediseño de marca Brisas', 'Landing de la feria'].map((n, i) => (
                    <span key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 30, borderBottom: `1px solid ${C.border}` }}>
                        <T size={9.5} weight={600} style={{ width: 160 }}>
                            {n}
                        </T>
                        <Chip label={['En curso', 'Pendiente', 'Terminado', 'En curso'][i]!} t={(['blue', 'slate', 'mint', 'blue'] as const)[i]} />
                    </span>
                ))}
            </At>

            {/* El registro que nace */}
            <At x={66} y={70} w={300} a="fpl-card" style={{ zIndex: 4, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 22px 46px -16px rgba(15,23,42,.55)', padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <T size={8} weight={600} color={C.mutedFg} style={{ border: `1px solid ${C.border}`, borderRadius: 5, padding: '1px 6px' }}>
                        Nuevo registro
                    </T>
                    <T size={8} color={C.mutedFg}>
                        desde «Proyecto de página web»
                    </T>
                </span>
                <T size={13} weight={800}>
                    Página web Panadería La Espiga
                </T>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Chip label="Pendiente" t="slate" />
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CalendarDays size={9} color={C.mutedFg} />
                        <T size={8.5}>Entrega 18/11/2026</T>
                        <T size={7.5} color={C.mutedFg}>
                            (15 días hábiles)
                        </T>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <User size={9} color={C.mutedFg} />
                        <Avatar initials="AM" t="violet" size={14} />
                    </span>
                </span>
                <T size={8.5} weight={700} color={C.mutedFg} style={{ marginTop: 2 }}>
                    Subtareas
                </T>
                {SUBS.map((s, i) => (
                    <span key={s} data-a="" style={{ display: 'flex', alignItems: 'center', gap: 6, animationName: `fpl-s${i}` }}>
                        <CornerDownRight size={10} color={C.mutedFg} />
                        <T size={9} weight={600} style={{ flex: 1 }}>
                            {s}
                        </T>
                        <T size={8} color={C.mutedFg}>
                            {['21/10', '31/10', '14/11'][i]}
                        </T>
                    </span>
                ))}
                <span data-a="" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, padding: '5px 8px', borderRadius: 7, background: tone('mint', 0.1), animationName: 'fpl-s3' }}>
                    <ListChecks size={11} color={tone('mint')} />
                    <T size={9} weight={600} style={{ flex: 1 }}>
                        Checklist «Antes de publicar»
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        0/5
                    </T>
                </span>
            </At>

            {/* Menú de plantillas */}
            <At x={286} y={46} w={176} a="fpl-menu" style={{ opacity: 0, zIndex: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: 5, boxShadow: '0 14px 30px -12px rgba(15,23,42,.55)' }}>
                <T size={7.5} weight={700} color={C.mutedFg} style={{ display: 'block', padding: '3px 6px 5px' }}>
                    Desde una plantilla
                </T>
                <span style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
                    <span data-a="" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 24, borderRadius: 6, background: primary(0.12), transform: 'translateY(24px)', animationName: 'fpl-hl' }} />
                    {TEMPLATES.map((t) => (
                        <span key={t} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, height: 24, padding: '0 6px' }}>
                            <BookmarkPlus size={10} color={C.mutedFg} />
                            <T size={9}>{t}</T>
                        </span>
                    ))}
                </span>
                <span style={{ display: 'block', height: 1, background: C.border, margin: '4px 0' }} />
                <T size={9} color={C.mutedFg} style={{ display: 'block', padding: '3px 6px' }}>
                    Administrar plantillas…
                </T>
            </At>
            <Cursor a="fpl-cur" click="fpl-ring" rest={[460, 250]} />
        </Stage>
    );
}
