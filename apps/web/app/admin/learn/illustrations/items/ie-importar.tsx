import { ArrowRight, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';

import { At, Btn, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Importar un Excel: se arrastra el archivo, cada columna se empareja con un
 * campo (o se crea uno nuevo) y al importar llegan los registros.
 */

const CSS = `
@keyframes im-file{0%,4%{opacity:0;transform:translate(0,0)}8%{opacity:1;transform:translate(0,0)}18%{opacity:1;transform:translate(212px,-4px) scale(.9)}21%,100%{opacity:0;transform:translate(212px,-4px) scale(.6)}}
@keyframes im-drop{0%,8%{opacity:1;border-color:${C.border}}12%,18%{opacity:1;border-color:${primary()};background:${primary(0.06)}}21%,100%{opacity:0}}
@keyframes im-map{0%,20%{opacity:0}24%,58%{opacity:1}62%,100%{opacity:0}}
@keyframes im-m1{0%,24%{opacity:0;transform:translateX(-6px)}28%,100%{opacity:1;transform:translateX(0)}}
@keyframes im-m2{0%,27%{opacity:0;transform:translateX(-6px)}31%,100%{opacity:1;transform:translateX(0)}}
@keyframes im-m3{0%,30%{opacity:0;transform:translateX(-6px)}34%,100%{opacity:1;transform:translateX(0)}}
@keyframes im-ign{0%,42%{opacity:1}45%,100%{opacity:0}}
@keyframes im-new{0%,42%{opacity:0}45%,100%{opacity:1}}
@keyframes im-press{0%,52%{transform:scale(1)}54%{transform:scale(.93)}57%,100%{transform:scale(1)}}
@keyframes im-res{0%,60%{opacity:0;transform:translateY(6px)}66%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes im-row{0%,66%{opacity:0;transform:translateX(-8px)}72%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes im-cur{0%{transform:translate(90px,120px);opacity:0}4%{opacity:1;transform:translate(90px,120px)}8%{transform:translate(90px,120px)}18%{transform:translate(302px,116px)}26%{transform:translate(300px,200px)}40%,43%{transform:translate(326px,136px)}50%,54%{transform:translate(431px,263px)}80%,88%{transform:translate(431px,263px);opacity:1}94%,100%{opacity:0}}
@keyframes im-ring{0%,41%{opacity:0;transform:scale(.4)}43%{opacity:1;transform:scale(1)}47%{opacity:0;transform:scale(1.6)}52%{opacity:0;transform:scale(.4)}54%{opacity:1;transform:scale(1)}58%,100%{opacity:0;transform:scale(1.6)}}
`;

const SHEET = [
    ['Razón social', 'NIT', 'Ciudad'],
    ['Trigo Dorado', '901234567', 'Medellín'],
    ['Hotel Mar Azul', '900765432', 'Santa Marta'],
    ['Droguería San Jorge', '830112233', 'Bogotá'],
];

const MAP: Array<[string, string, string, string]> = [
    ['Razón social', 'Razón social', 'Trigo Dorado · Hotel Mar…', 'im-m1'],
    ['NIT', 'NIT / RUT', '901234567 · 900765432…', 'im-m2'],
];

const SEL = { height: 18, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px', background: C.card } as const;

export default function IeImportar(): JSX.Element {
    return (
        <Stage label="Se arrastra un Excel de clientes al importador; cada columna se empareja con un campo, la columna Ciudad se crea como campo nuevo y al importar llegan tres registros." tint="mint">
            <Keyframes css={CSS} />
            {/* La planilla de origen */}
            <At x={12} y={34} w={176} h={118} style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 14px 30px -20px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', background: tone('mint'), color: '#fff' }}>
                    <FileSpreadsheet size={10} />
                    <T size={8} weight={700} color="#fff">
                        clientes-nuevos.xlsx
                    </T>
                </span>
                {SHEET.map((r, i) => (
                    <span key={i} style={{ display: 'flex', height: 22, borderBottom: `1px solid ${C.border}`, background: i === 0 ? C.muted : 'transparent' }}>
                        {r.map((c, j) => (
                            <span key={j} style={{ width: [72, 54, 50][j], display: 'flex', alignItems: 'center', padding: '0 4px', borderRight: `1px solid ${C.border}`, overflow: 'hidden' }}>
                                <T size={7} weight={i === 0 ? 700 : 500} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {c}
                                </T>
                            </span>
                        ))}
                    </span>
                ))}
            </At>
            {/* El archivo que viaja */}
            <At x={72} y={108} a="im-file" style={{ opacity: 0, zIndex: 7 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 7, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 10px 24px -10px rgba(15,23,42,.6)' }}>
                    <FileSpreadsheet size={11} color={tone('mint')} />
                    <T size={7.5} weight={700}>
                        clientes-nuevos.xlsx
                    </T>
                </span>
            </At>

            {/* El importador */}
            <At x={198} y={14} w={270} h={272} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)', padding: 12, overflow: 'hidden' }}>
                <T size={10.5} weight={700}>
                    Importar desde CSV o Excel
                </T>
                {/* Paso 1: soltar */}
                <At x={12} y={36} w={246} h={110} a="im-drop" style={{ borderRadius: 10, border: `1.5px dashed ${C.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    <Upload size={16} color={primary()} />
                    <T size={8.5} weight={700}>
                        Elige un archivo Excel (.xlsx) o CSV
                    </T>
                    <T size={7} color={C.mutedFg}>
                        Hasta 5.000 filas por importación
                    </T>
                </At>
                {/* Paso 2: emparejar */}
                <At x={12} y={34} w={246} h={226} a="im-map" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <T size={7.5} color={C.mutedFg}>
                        3 filas detectadas · 3 columnas
                    </T>
                    <span style={{ display: 'flex', gap: 6 }}>
                        <span style={{ width: 62, display: 'flex' }}>
                            <T size={7} weight={700} color={C.mutedFg}>
                                Columna
                            </T>
                        </span>
                        <T size={7} weight={700} color={C.mutedFg}>
                            Campo destino
                        </T>
                    </span>
                    {MAP.map(([col, dest, ex, a]) => (
                        <span key={col} data-a="" style={{ display: 'flex', alignItems: 'center', gap: 6, animationName: a }}>
                            <span style={{ width: 62, display: 'flex' }}>
                                <T size={8} weight={600}>
                                    {col}
                                </T>
                            </span>
                            <span style={{ ...SEL, width: 104 }}>
                                <T size={7.5}>{dest}</T>
                            </span>
                            <T size={6.5} color={C.mutedFg} style={{ overflow: 'hidden', textOverflow: 'ellipsis', width: 62 }}>
                                {ex}
                            </T>
                        </span>
                    ))}
                    <span data-a="" style={{ display: 'flex', alignItems: 'center', gap: 6, animationName: 'im-m3' }}>
                        <span style={{ width: 62, display: 'flex' }}>
                            <T size={8} weight={600}>
                                Ciudad
                            </T>
                        </span>
                        <span style={{ ...SEL, width: 104, position: 'relative' }}>
                            <span data-a="" style={{ position: 'absolute', left: 6, display: 'flex', animationName: 'im-ign', opacity: 0 }}>
                                <T size={7.5} color={C.mutedFg}>
                                    — Ignorar —
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 6, display: 'flex', animationName: 'im-new' }}>
                                <T size={7.5} weight={700} color={primary()}>
                                    + Crear campo nuevo
                                </T>
                            </span>
                        </span>
                        <T size={6.5} color={C.mutedFg}>
                            Medellín · Santa…
                        </T>
                    </span>
                    <span data-a="" style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 68, animationName: 'im-new' }}>
                        <T size={6.5} color={C.mutedFg}>
                            Tipo sugerido por los datos:
                        </T>
                        <T size={6.5} weight={700}>
                            Selección
                        </T>
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 'auto' }}>
                        <Btn kind="outline" label="Atrás" style={{ height: 19, fontSize: 8 }} />
                        <span data-a="" style={{ display: 'flex', animationName: 'im-press' }}>
                            <Btn label="Importar" style={{ height: 19, fontSize: 8 }} />
                        </span>
                    </span>
                </At>
                {/* Paso 3: resultado */}
                <At x={12} y={36} w={246} h={220} a="im-res" style={{ opacity: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 9, background: tone('mint', 0.14) }}>
                        <CheckCircle2 size={14} color={tone('mint')} />
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <T size={9} weight={700}>
                                3 registros importados
                            </T>
                            <T size={7} color={C.mutedFg}>
                                0 omitidos · 1 campo nuevo: Ciudad
                            </T>
                        </span>
                    </span>
                    {SHEET.slice(1).map((r, i) => (
                        <span key={i} data-a="" style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px', borderRadius: 7, border: `1px solid ${C.border}`, animationName: 'im-row', animationDelay: `${i * 0.1}s` }}>
                            <ArrowRight size={9} color={tone('mint')} />
                            <span style={{ width: 96, display: 'flex' }}>
                                <T size={8} weight={600}>
                                    {r[0]}
                                </T>
                            </span>
                            <span style={{ width: 58, display: 'flex' }}>
                                <T size={7.5} color={C.mutedFg}>
                                    {r[1]}
                                </T>
                            </span>
                            <T size={7.5}>{r[2]}</T>
                        </span>
                    ))}
                </At>
            </At>
            <Cursor a="im-cur" click="im-ring" rest={[431, 263]} />
        </Stage>
    );
}
