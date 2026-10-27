import { At, Btn, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Pegar desde Excel: se copia la columna de precios, se pega en la tabla, la revisión avisa la celda que no es un número y el resto se aplica. */

const XL = '#107C41';
const NEW = ['$ 36.000', '$ 168.000', 'consultar', '$ 61.000', '$ 118.000'];
const OLD = ['$ 34.000', '$ 160.000', '$ 22.000', '$ 57.000', '$ 113.000'];
const PROD = ['Café de origen', 'Molino manual', 'Taza de cerámica', 'Filtros x100', 'Jarra para leche'];

const CSS = `
@keyframes lp-ants{to{background-position:16px 0,-16px 100%,0 -16px,100% 16px}}
@keyframes lp-copy{0%,3%{opacity:0}6%,26%{opacity:1}30%,100%{opacity:0}}
@keyframes lp-paste{0%,17%{opacity:0;transform:translateY(4px)}20%,28%{opacity:1;transform:translateY(0)}32%,100%{opacity:0}}
@keyframes lp-dlg{0%,28%{opacity:0;transform:translateY(8px) scale(.97)}32%,55%{opacity:1;transform:translateY(0) scale(1)}58%,100%{opacity:0;transform:scale(.98)}}
@keyframes lp-old{0%,57%{opacity:1}60%,96%{opacity:0}100%{opacity:1}}
@keyframes lp-new{0%,57%{opacity:0}60%,96%{opacity:1}100%{opacity:0}}
@keyframes lp-err{0%,58%{box-shadow:inset 0 0 0 0 transparent;background:transparent}61%,95%{box-shadow:inset 0 0 0 1.5px ${C.destructive};background:hsl(var(--imcrm-destructive) / .08)}100%{box-shadow:inset 0 0 0 0 transparent}}
@keyframes lp-cur{0%{transform:translate(110px,280px);opacity:0}6%{opacity:1}12%,24%{transform:translate(122px,150px)}40%,57%{transform:translate(414px,200px);opacity:1}72%,90%{transform:translate(440px,262px);opacity:1}96%,100%{transform:translate(440px,262px);opacity:0}}
@keyframes lp-ring{0%,55%{opacity:0;transform:scale(.4)}56%{opacity:1;transform:scale(1)}59%,100%{opacity:0;transform:scale(1.6)}}
`;

function Key({ label, x, y, a }: { label: string; x: number; y: number; a: string }): JSX.Element {
    return (
        <At x={x} y={y} a={a} style={{ opacity: 0, zIndex: 9, padding: '3px 8px', borderRadius: 6, border: `1px solid ${C.border}`, borderBottomWidth: 2, background: C.card, fontSize: 10, fontWeight: 700, boxShadow: '0 6px 14px -8px rgba(15,23,42,.5)' }}>
            {label}
        </At>
    );
}

export default function LotePegar(): JSX.Element {
    return (
        <Stage label="Una columna de precios se copia en Excel y se pega en la tabla de productos. Antes de aplicar, la revisión avisa que «consultar» no es un número; se pegan los otros cuatro precios y esa celda queda marcada en rojo." tint="mint">
            <Keyframes css={CSS} />
            {/* Excel */}
            <At x={12} y={52} w={150} h={196} style={{ borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`, background: C.card, boxShadow: '0 10px 30px -12px rgba(15,23,42,.35)' }}>
                <div style={{ height: 22, background: XL, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 2, background: '#fff', color: XL, fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>X</span>
                    <T size={9} weight={600} color="#fff">
                        precios-proveedor.xlsx
                    </T>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '18px 1fr 64px', fontSize: 8.5 }}>
                    {['', 'A', 'B'].map((h, i) => (
                        <span key={i} style={{ height: 16, background: C.muted, borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.mutedFg, fontWeight: 700 }}>
                            {h}
                        </span>
                    ))}
                    {PROD.map((p, i) => [
                        <span key={`n${i}`} style={{ height: 26, background: C.muted, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.mutedFg }}>
                            {i + 1}
                        </span>,
                        <span key={`a${i}`} style={{ height: 26, borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 4px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                            {p.split(' ')[0]}
                        </span>,
                        <span key={`b${i}`} style={{ height: 26, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 4px', background: tone('mint', 0.12) }}>
                            {NEW[i]}
                        </span>,
                    ])}
                </div>
                {/* Hormigas del copiado */}
                <span
                    style={{
                        position: 'absolute',
                        left: 85,
                        top: 38,
                        width: 64,
                        height: 130,
                        backgroundImage: `linear-gradient(90deg, ${XL} 50%, transparent 50%), linear-gradient(90deg, ${XL} 50%, transparent 50%), linear-gradient(0deg, ${XL} 50%, transparent 50%), linear-gradient(0deg, ${XL} 50%, transparent 50%)`,
                        backgroundRepeat: 'repeat-x, repeat-x, repeat-y, repeat-y',
                        backgroundSize: '8px 1.5px, 8px 1.5px, 1.5px 8px, 1.5px 8px',
                        backgroundPosition: '0 0, 0 100%, 0 0, 100% 0',
                        animation: 'lp-ants .8s linear infinite',
                    }}
                />
            </At>
            <Key label="Ctrl + C" x={44} y={256} a="lp-copy" />

            {/* La tabla de la app */}
            <Win x={176} y={22} w={290} h={258} title="Productos · Tabla">
                <At x={10} y={8} w={270} h={22} style={{ display: 'grid', gridTemplateColumns: '1fr 96px', alignItems: 'center', padding: '0 8px', background: C.muted, borderRadius: 6 }}>
                    <T size={8.5} weight={700} color={C.mutedFg}>
                        Producto
                    </T>
                    <T size={8.5} weight={700} color={C.mutedFg} style={{ textAlign: 'right' }}>
                        Precio
                    </T>
                </At>
                {PROD.map((p, i) => (
                    <At key={p} x={10} y={32 + i * 30} w={270} h={30} style={{ display: 'grid', gridTemplateColumns: '1fr 96px', alignItems: 'center', padding: '0 8px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={9.5} weight={600}>
                            {p}
                        </T>
                        <span data-a={i === 2 ? '' : undefined} style={{ position: 'relative', height: 26, borderRadius: 3, animationName: i === 2 ? 'lp-err' : undefined, boxShadow: i === 2 ? `inset 0 0 0 1.5px ${C.destructive}` : undefined }}>
                            <span data-a="" style={{ position: 'absolute', right: 6, top: 6, opacity: i === 2 ? 1 : 0, animationName: i === 2 ? undefined : 'lp-old', fontSize: 9.5, color: C.mutedFg }}>
                                {OLD[i]}
                            </span>
                            {i !== 2 && (
                                <span data-a="" style={{ position: 'absolute', right: 6, top: 6, animationName: 'lp-new', fontSize: 9.5, fontWeight: 700, color: tone('mint') }}>
                                    {NEW[i]}
                                </span>
                            )}
                        </span>
                    </At>
                ))}
                <Key label="Ctrl + V" x={200} y={-18} a="lp-paste" />

                {/* Revisión antes de pegar */}
                <At
                    x={14}
                    y={52}
                    w={262}
                    a="lp-dlg"
                    style={{ opacity: 0, zIndex: 8, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 11, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 18px 40px -14px rgba(15,23,42,.6)' }}
                >
                    <T size={11} weight={700}>
                        Revisa antes de pegar
                    </T>
                    <T size={9} color={C.mutedFg}>
                        Pegaste un bloque de 5 × 1. Se van a cambiar 4 celdas.
                    </T>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '34px 56px 1fr', padding: '3px 6px', background: C.muted }}>
                            {['Fila', 'Valor', 'Motivo'].map((h) => (
                                <T key={h} size={8} weight={700} color={C.mutedFg}>
                                    {h}
                                </T>
                            ))}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '34px 56px 1fr', padding: '4px 6px' }}>
                            <T size={8.5}>3</T>
                            <T size={8.5} weight={600}>
                                consultar
                            </T>
                            <T size={8.5} color={C.destructive}>
                                no es un número
                            </T>
                        </div>
                    </div>
                    <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <Btn label="Cancelar" kind="outline" />
                        <Btn label="Pegar" style={{ background: primary() }} />
                    </span>
                </At>
            </Win>
            <Cursor a="lp-cur" click="lp-ring" rest={[440, 262]} />
        </Stage>
    );
}
