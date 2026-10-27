import { BellRing, Clock, Database } from 'lucide-react';

import { At, C, IconSquare, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Cada cuánto corre: la primera carga trae todo y no dispara automatizaciones;
 * las siguientes, cada hora, traen sólo lo que cambió desde la última
 * sincronización y disparan las automatizaciones con el valor anterior y el
 * nuevo.
 */

const RUNS = [
    { h: '8:00', title: 'Primera carga', detail: '1.250 creadas', note: 'Sin automatizaciones', first: true },
    { h: '9:00', title: 'Sólo lo que cambió', detail: '3 actualizadas · 1 creada', note: '4 automatizaciones', first: false },
    { h: '10:00', title: 'Sólo lo que cambió', detail: '2 actualizadas', note: '2 automatizaciones', first: false },
];

const CSS = `
${RUNS.map(
    (_, i) => `
@keyframes ss-c${i}{0%,${6 + i * 24}%{opacity:.25;transform:translateY(8px)}${12 + i * 24}%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:.25}}
@keyframes ss-d${i}{0%,${4 + i * 24}%{background:${C.card};transform:scale(1)}${8 + i * 24}%{background:${primary()};transform:scale(1.25)}${12 + i * 24}%,92%{background:${primary()};transform:scale(1)}97%,100%{background:${C.card}}}`,
).join('')}
@keyframes ss-line{0%,4%{width:0}76%,100%{width:384px}}
@keyframes ss-bell{0%,40%{opacity:0;transform:translateY(-4px) rotate(0)}44%{opacity:1;transform:translateY(0) rotate(-12deg)}48%{transform:rotate(12deg)}52%,92%{opacity:1;transform:rotate(0)}97%,100%{opacity:0}}
`;

export default function SqlSchedule(): JSX.Element {
    return (
        <Stage label="La primera carga trae todo sin disparar automatizaciones; después, cada hora, sólo se trae lo que cambió y las automatizaciones corren con el valor anterior y el nuevo." tint="rose">
            <Keyframes css={CSS} />

            <At x={22} y={20} w={436} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <IconSquare t="rose" size={24}>
                    <Database size={13} />
                </IconSquare>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <T size={10.5} weight={700}>
                        Facturas desde el ERP
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={10} color={C.mutedFg} />
                        <T size={8.5} color={C.mutedFg}>
                            Cada hora · consulta con @ultima_sincronizacion
                        </T>
                    </span>
                </span>
            </At>

            {/* La línea de tiempo */}
            <At x={48} y={98} w={384} h={2} style={{ background: C.border }} />
            <At x={48} y={98} h={2} a="ss-line" style={{ width: 384, background: primary(0.6) }} />

            {RUNS.map((r, i) => {
                const x = 48 + i * 150;
                return (
                    <At key={r.h} x={x - 8} y={86} w={160}>
                        <span data-a="" style={{ animationName: `ss-d${i}`, display: 'block', width: 14, height: 14, borderRadius: 99, border: `3px solid ${primary()}`, background: primary(), marginLeft: 1 }} />
                        <At x={-2} y={-20}>
                            <T size={9} weight={700} color={C.mutedFg}>
                                {r.h}
                            </T>
                        </At>
                        <At
                            x={-6}
                            y={30}
                            w={138}
                            a={`ss-c${i}`}
                            style={{ background: C.card, border: `1px solid ${r.first ? tone('violet', 0.45) : C.border}`, borderRadius: 10, padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 4, boxShadow: '0 8px 22px -14px rgba(15,23,42,.45)' }}
                        >
                            <T size={9.5} weight={700}>
                                {r.title}
                            </T>
                            <T size={8.5} color={C.mutedFg}>
                                {r.detail}
                            </T>
                            <span style={{ alignSelf: 'flex-start', height: 16, padding: '0 6px', borderRadius: 99, background: r.first ? tone('violet', 0.14) : tone('mint', 0.14), color: r.first ? tone('violet') : tone('mint'), fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                                {r.note}
                            </span>
                        </At>
                    </At>
                );
            })}

            {/* Una automatización que reacciona a un cambio */}
            <At x={196} y={214} w={262} a="ss-bell" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 10px 24px -14px rgba(15,23,42,.5)' }}>
                <IconSquare t="amber" size={24}>
                    <BellRing size={12} />
                </IconSquare>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={9.5} weight={700}>
                        «Factura pagada» se disparó
                    </T>
                    <T size={8} color={C.mutedFg}>
                        Estado: Pendiente → Pagada · FAC-1040
                    </T>
                </span>
            </At>
        </Stage>
    );
}
