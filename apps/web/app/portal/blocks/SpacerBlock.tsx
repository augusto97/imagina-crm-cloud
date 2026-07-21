/** v0.1.94 — espacio vertical fijo. */
export function SpacerBlock({ config }: { config: { height?: number } }): JSX.Element {
    const height = typeof config.height === 'number' && config.height > 0 ? config.height : 32;
    return <div style={{ height: `${height}px` }} aria-hidden />;
}
