import { Check, KeyRound } from 'lucide-react';

import { At, C, Chip, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Qué hace una corrida: cada fila del resultado se empareja por la columna
 * clave. La que ya existe y cambió se actualiza (sólo lo que cambió), la que
 * no existe se crea, la que no cambió no se toca, y la que dejó de aparecer se
 * marca «ya no está» (opcional). Abajo, el resumen de la corrida.
 */

const CSS = `
@keyframes su-upd{0%,14%{background:transparent}18%,30%{background:${tone('amber', 0.2)}}40%,100%{background:transparent}}
@keyframes su-old{0%,18%{opacity:1}22%,100%{opacity:0}}
@keyframes su-new{0%,18%{opacity:0}22%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes su-add{0%,34%{opacity:0;transform:translateY(-6px);background:transparent}40%{opacity:1;transform:translateY(0);background:${tone('mint', 0.2)}}54%,92%{opacity:1;background:transparent}97%,100%{opacity:0}}
@keyframes su-flag{0%,52%{opacity:1}58%,92%{opacity:.5}97%,100%{opacity:1}}
@keyframes su-chk{0%,52%{opacity:1}56%,100%{opacity:0}}
@keyframes su-tag{0%,54%{opacity:0;transform:scale(.6)}60%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes su-sum{0%,66%{opacity:0;transform:translateY(6px)}72%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes su-l1{0%,10%{opacity:0}14%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes su-l2{0%,30%{opacity:0}34%,92%{opacity:1}97%,100%{opacity:0}}
`;

const COLS = '64px 1fr 66px 34px';

function Head(): JSX.Element {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 4, height: 22, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <KeyRound size={9} color={primary()} />
                <T size={7.5} weight={700} color={C.mutedFg}>
                    Factura
                </T>
            </span>
            <T size={7.5} weight={700} color={C.mutedFg}>
                Cliente
            </T>
            <T size={7.5} weight={700} color={C.mutedFg}>
                Estado
            </T>
            <T size={7.5} weight={700} color={C.mutedFg}>
                En SQL
            </T>
        </div>
    );
}

function Box({ checked }: { checked: boolean }): JSX.Element {
    return (
        <span style={{ width: 13, height: 13, borderRadius: 3, border: `1.5px solid ${checked ? primary() : C.border}`, background: checked ? primary() : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            {checked && <Check size={9} color={C.primaryFg} strokeWidth={3} />}
        </span>
    );
}

export default function SqlUpsert(): JSX.Element {
    return (
        <Stage label="En cada corrida, cada fila se empareja por el número de factura: la que cambió se actualiza, la nueva se crea, la que no cambió no se toca y la que dejó de aparecer se marca como que ya no está en SQL." tint="rose">
            <Keyframes css={CSS} />

            {/* El resultado de la consulta */}
            <At x={18} y={26} w={150} h={150} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: '8px 10px', fontFamily: 'ui-monospace, Menlo, monospace', boxShadow: '0 10px 26px -16px rgba(15,23,42,.5)' }}>
                <T size={7.5} weight={700} color={C.mutedFg} style={{ display: 'block', marginBottom: 6, fontFamily: 'inherit' }}>
                    RESULTADO DE LA CONSULTA
                </T>
                {[
                    ['FAC-1040', 'Pagada', 'su-l1'],
                    ['FAC-1041', 'Pendiente', ''],
                    ['FAC-1042', 'Pendiente', ''],
                    ['FAC-1044', 'Pendiente', 'su-l2'],
                ].map(([n, s, a]) => (
                    <span key={n} data-a={a ? '' : undefined} style={{ display: 'flex', justifyContent: 'space-between', height: 24, alignItems: 'center', borderBottom: `1px dashed ${C.border}`, animationName: a || undefined, color: a ? primary() : C.fg }}>
                        <T size={8.5} weight={700} color="inherit" style={{ fontFamily: 'inherit' }}>
                            {n}
                        </T>
                        <T size={8} color="inherit" style={{ fontFamily: 'inherit' }}>
                            {s}
                        </T>
                    </span>
                ))}
            </At>
            <At x={18} y={184} w={150}>
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                    FAC-1039 ya no aparece en el resultado.
                </T>
            </At>

            {/* La lista */}
            <At x={186} y={18} w={276} h={210} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 36px -18px rgba(15,23,42,.55)' }}>
                <div style={{ height: 30, display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={9.5} weight={700}>
                        Facturas del ERP
                    </T>
                </div>
                <Head />
                {/* actualizada */}
                <div data-a="" style={{ animationName: 'su-upd', display: 'grid', gridTemplateColumns: COLS, gap: 4, height: 30, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={8.5} weight={700}>
                        FAC-1040
                    </T>
                    <T size={8.5}>Hotel Brisas</T>
                    <span style={{ position: 'relative', display: 'block', height: 16 }}>
                        <span data-a="" style={{ animationName: 'su-old', position: 'absolute', left: 0, top: 0, opacity: 0, display: 'flex' }}>
                            <Chip label="Pendiente" t="amber" />
                        </span>
                        <span data-a="" style={{ animationName: 'su-new', position: 'absolute', left: 0, top: 0, display: 'flex' }}>
                            <Chip label="Pagada" t="mint" />
                        </span>
                    </span>
                    <Box checked />
                </div>
                {[
                    ['FAC-1041', 'Clínica Norte'],
                    ['FAC-1042', 'Colegio Andino'],
                ].map(([n, c]) => (
                    <div key={n} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 4, height: 30, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={700}>
                            {n}
                        </T>
                        <T size={8.5}>{c}</T>
                        <Chip label="Pendiente" t="amber" />
                        <Box checked />
                    </div>
                ))}
                {/* ya no está */}
                <div data-a="" style={{ animationName: 'su-flag', display: 'grid', gridTemplateColumns: COLS, gap: 4, height: 30, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}`, opacity: 0.5 }}>
                    <T size={8.5} weight={700}>
                        FAC-1039
                    </T>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
                        <T size={8.5}>Óptica Visión</T>
                        <span data-a="" style={{ animationName: 'su-tag', display: 'inline-flex', height: 12, alignItems: 'center', padding: '0 4px', borderRadius: 3, background: C.muted, color: C.mutedFg, fontSize: 7, fontWeight: 700 }}>
                            ya no está
                        </span>
                    </span>
                    <Chip label="Pendiente" t="amber" />
                    <span style={{ position: 'relative', display: 'block', width: 13, height: 13 }}>
                        <span data-a="" style={{ animationName: 'su-chk', position: 'absolute', inset: 0, opacity: 0 }}>
                            <Box checked />
                        </span>
                        <span style={{ position: 'absolute', inset: 0 }}>
                            <Box checked={false} />
                        </span>
                    </span>
                </div>
                {/* nueva */}
                <div data-a="" style={{ animationName: 'su-add', display: 'grid', gridTemplateColumns: COLS, gap: 4, height: 30, alignItems: 'center', padding: '0 10px' }}>
                    <T size={8.5} weight={700}>
                        FAC-1044
                    </T>
                    <T size={8.5}>Panadería La Espiga</T>
                    <Chip label="Pendiente" t="amber" />
                    <Box checked />
                </div>
            </At>

            {/* Resumen de la corrida */}
            <At x={186} y={238} w={276} a="su-sum" style={{ display: 'flex', gap: 4 }}>
                {[
                    ['creada', '1', 'mint'],
                    ['actualizada', '1', 'amber'],
                    ['sin cambios', '2', 'slate'],
                    ['ya no está', '1', 'rose'],
                ].map(([l, n, t]) => (
                    <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 6px', borderRadius: 7, background: C.card, border: `1px solid ${C.border}`, fontSize: 8.5, whiteSpace: 'nowrap' }}>
                        <b style={{ color: tone(t as 'mint') }}>{n}</b>
                        <span style={{ color: C.mutedFg, fontWeight: 600 }}>{l}</span>
                    </span>
                ))}
            </At>
        </Stage>
    );
}
