/** Bytes legibles para la tarjeta Disco (GB con un decimal, MB y KB redondeados). */
export function diskSize(bytes: number | null): string {
    if (bytes === null) return '—';
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
}
