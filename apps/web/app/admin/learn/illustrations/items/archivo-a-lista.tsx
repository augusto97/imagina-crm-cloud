import { FileSpreadsheet, Link2, Sparkles, Split } from 'lucide-react';

import { At, C, Chip, Keyframes, Pill, Stage, T, primary, tone } from '../kit';

/**
 * v0.1.339 — «Crear desde un archivo»: de una planilla sale un plan columna
 * por columna (tipo y motivo), la IA junta opciones escritas distinto y el
 * cliente repetido pasa a su propia lista, vinculada.
 */

const CSS = `
@keyframes al-r1{0%,8%{opacity:0;transform:translateX(-8px)}12%,94%{opacity:1;transform:translateX(0)}98%,100%{opacity:0}}
@keyframes al-r2{0%,14%{opacity:0;transform:translateX(-8px)}18%,94%{opacity:1;transform:translateX(0)}98%,100%{opacity:0}}
@keyframes al-r3{0%,20%{opacity:0;transform:translateX(-8px)}24%,94%{opacity:1;transform:translateX(0)}98%,100%{opacity:0}}
@keyframes al-r4{0%,26%{opacity:0;transform:translateX(-8px)}30%,94%{opacity:1;transform:translateX(0)}98%,100%{opacity:0}}
@keyframes al-r5{0%,32%{opacity:0;transform:translateX(-8px)}36%,94%{opacity:1;transform:translateX(0)}98%,100%{opacity:0}}
@keyframes al-raw{0%,44%{opacity:1}48%,100%{opacity:0}}
@keyframes al-clean{0%,44%{opacity:0;transform:scale(.9)}50%,94%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
@keyframes al-ai{0%,40%{opacity:0;transform:translateY(6px)}46%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes al-l1{0%,60%{opacity:0;transform:translateY(8px)}66%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes al-l2{0%,66%{opacity:0;transform:translateY(8px)}72%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes al-link{0%,72%{opacity:0;transform:scaleY(0)}78%,94%{opacity:1;transform:scaleY(1)}98%,100%{opacity:0}}
`;

const SHEET = [
    ['N°', 'Cliente', 'Correo', 'Valor', 'Estado'],
    ['F-101', 'Café Aurora', 'pagos@…', '1.250.000', 'PAGADO'],
    ['F-102', 'Óptica Sol', 'admin@…', '890.000', 'pagada'],
    ['F-103', 'Café Aurora', 'pagos@…', '2.100.000', 'Pendiente'],
];
const COLS = [30, 48, 36, 40, 34];

const ROW = { display: 'flex', alignItems: 'center', gap: 6, height: 24, padding: '0 6px', borderBottom: `1px solid ${C.border}` } as const;

export default function ArchivoALista(): JSX.Element {
    return (
        <Stage
            label="Una planilla de facturas se convierte en un plan: cada columna con su tipo (texto, vínculo, correo, moneda, selección), la IA junta «PAGADO» y «pagada» en una opción, y salen dos listas vinculadas: Facturas y Clientes."
            tint="mint"
            cycle={8}
        >
            <Keyframes css={CSS} />
            {/* La planilla */}
            <At x={10} y={26} w={196} h={112} style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 14px 30px -20px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 20, padding: '0 8px', background: tone('mint'), color: '#fff' }}>
                    <FileSpreadsheet size={10} />
                    <T size={8} weight={700} color="#fff">
                        facturas.xlsx
                    </T>
                </span>
                {SHEET.map((r, i) => (
                    <span key={i} style={{ display: 'flex', height: 22, borderBottom: `1px solid ${C.border}`, background: i === 0 ? C.muted : 'transparent' }}>
                        {r.map((c, j) => (
                            <span key={j} style={{ width: COLS[j], display: 'flex', alignItems: 'center', padding: '0 3px', borderRight: `1px solid ${C.border}`, overflow: 'hidden' }}>
                                <T size={6.5} weight={i === 0 ? 700 : 500} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {c}
                                </T>
                            </span>
                        ))}
                    </span>
                ))}
            </At>

            {/* El plan */}
            <At x={218} y={14} w={252} h={176} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)', padding: '10px 8px', overflow: 'hidden' }}>
                <T size={9.5} weight={700} style={{ padding: '0 6px' }}>
                    Así se va a crear
                </T>
                <span style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
                    <span data-a="" style={{ ...ROW, animationName: 'al-r1' }}>
                        <T size={7.5} weight={600} style={{ width: 54 }}>
                            N°
                        </T>
                        <T size={7.5}>Texto</T>
                        <T size={6.5} weight={700} color={primary()}>
                            · título
                        </T>
                    </span>
                    <span data-a="" style={{ ...ROW, animationName: 'al-r2' }}>
                        <T size={7.5} weight={600} style={{ width: 54 }}>
                            Cliente
                        </T>
                        <Link2 size={9} color={primary()} />
                        <T size={7.5} weight={600} color={primary()}>
                            Vínculo a «Clientes»
                        </T>
                    </span>
                    <span data-a="" style={{ ...ROW, animationName: 'al-r3', background: primary(0.05) }}>
                        <T size={7.5} weight={600} style={{ width: 54 }}>
                            Correo
                        </T>
                        <T size={7.5}>Email</T>
                        <Split size={8} color={primary()} />
                        <T size={6.5} color={primary()}>
                            pasa a «Clientes»
                        </T>
                    </span>
                    <span data-a="" style={{ ...ROW, animationName: 'al-r4' }}>
                        <T size={7.5} weight={600} style={{ width: 54 }}>
                            Valor
                        </T>
                        <T size={7.5}>Moneda</T>
                        <T size={6.5} color={C.mutedFg}>
                            1250000 · 890000
                        </T>
                    </span>
                    <span data-a="" style={{ ...ROW, animationName: 'al-r5', borderBottom: 'none', position: 'relative' }}>
                        <T size={7.5} weight={600} style={{ width: 54 }}>
                            Estado
                        </T>
                        <T size={7.5}>Selección</T>
                        <span data-a="" style={{ position: 'absolute', left: 116, display: 'flex', gap: 3, animationName: 'al-raw', opacity: 0 }}>
                            <Chip label="PAGADO" t="slate" style={{ height: 13, fontSize: 6.5, padding: '0 4px' }} />
                            <Chip label="pagada" t="slate" style={{ height: 13, fontSize: 6.5, padding: '0 4px' }} />
                            <Chip label="Pendiente" t="slate" style={{ height: 13, fontSize: 6.5, padding: '0 4px' }} />
                        </span>
                        <span data-a="" style={{ position: 'absolute', left: 116, display: 'flex', gap: 3, animationName: 'al-clean' }}>
                            <Chip label="Pagada" t="mint" style={{ height: 13, fontSize: 6.5, padding: '0 4px' }} />
                            <Chip label="Pendiente" t="amber" style={{ height: 13, fontSize: 6.5, padding: '0 4px' }} />
                        </span>
                    </span>
                </span>
            </At>
            {/* La IA */}
            <At x={230} y={196} a="al-ai">
                <Pill t="blue" icon={<Sparkles size={9} />} label="IA: juntó «PAGADO» y «pagada»" />
            </At>

            {/* Las listas que salen */}
            <At x={24} y={168} w={160} a="al-l1" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 12px 26px -18px rgba(15,23,42,.5)' }}>
                <span style={{ width: 18, height: 18, borderRadius: 5, background: tone('amber'), display: 'flex' }} />
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <T size={8.5} weight={700}>
                        Facturas
                    </T>
                    <T size={6.5} color={C.mutedFg}>
                        60 registros
                    </T>
                </span>
            </At>
            <At x={95} y={210} w={2} h={24} a="al-link" style={{ background: primary(), transformOrigin: 'top' }} />
            <At x={24} y={236} w={160} a="al-l2" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 12px 26px -18px rgba(15,23,42,.5)' }}>
                <span style={{ width: 18, height: 18, borderRadius: 5, background: tone('blue'), display: 'flex' }} />
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <T size={8.5} weight={700}>
                        Clientes
                    </T>
                    <T size={6.5} color={C.mutedFg}>
                        5 registros · vinculada
                    </T>
                </span>
            </At>
        </Stage>
    );
}
