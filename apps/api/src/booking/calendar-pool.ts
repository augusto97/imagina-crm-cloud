/**
 * Un cupo para las lecturas de calendarios externos (Google, Outlook) de las
 * páginas públicas de agenda: tantas a la vez en total y tantas por empresa.
 *
 * Antes esas lecturas corrían DENTRO del tope de armados de lo público (8 en
 * total para todas las empresas): una agenda con un calendario lento se
 * quedaba con los 8 lugares varios segundos y las páginas públicas de las
 * demás empresas respondían «muchas visitas». Ahora la red va por aquí, fuera
 * de ese tope, y una empresa no puede usar más que su parte.
 *
 * Lo que no entra espera un rato; si la espera se alarga, `run` devuelve
 * `null` (quien llama sigue sin ese calendario, como cuando falla).
 */
export interface CalendarPoolOptions {
    total: number;
    perKey: number;
    maxWaitMs: number;
    maxQueue: number;
}

interface Waiter {
    key: string;
    start: () => void;
    timer: ReturnType<typeof setTimeout>;
}

export class CalendarPool {
    private active = 0;
    private readonly byKey = new Map<string, number>();
    private readonly waiters: Waiter[] = [];

    constructor(private readonly opts: CalendarPoolOptions) {}

    stats(): { active: number; queued: number } {
        return { active: this.active, queued: this.waiters.length };
    }

    private free(key: string): boolean {
        return this.active < this.opts.total && (this.byKey.get(key) ?? 0) < this.opts.perKey;
    }

    private take(key: string): void {
        this.active += 1;
        this.byKey.set(key, (this.byKey.get(key) ?? 0) + 1);
    }

    private release(key: string): void {
        this.active -= 1;
        const n = (this.byKey.get(key) ?? 1) - 1;
        if (n <= 0) this.byKey.delete(key);
        else this.byKey.set(key, n);
        // El primero de la fila que AHORA entra (otra empresa puede pasar a una que está en su tope).
        const i = this.waiters.findIndex((w) => this.free(w.key));
        if (i >= 0) {
            const [w] = this.waiters.splice(i, 1);
            clearTimeout(w!.timer);
            this.take(w!.key);
            w!.start();
        }
    }

    /** Corre `task` dentro del cupo; `null` si no consiguió lugar a tiempo. */
    async run<T>(key: string, task: () => Promise<T>): Promise<T | null> {
        if (this.free(key)) this.take(key);
        else {
            if (this.waiters.length >= this.opts.maxQueue) return null;
            const got = await new Promise<boolean>((resolve) => {
                const waiter: Waiter = {
                    key,
                    start: () => resolve(true),
                    timer: setTimeout(() => {
                        const i = this.waiters.indexOf(waiter);
                        if (i >= 0) this.waiters.splice(i, 1);
                        resolve(false);
                    }, this.opts.maxWaitMs),
                };
                this.waiters.push(waiter);
            });
            if (!got) return null;
        }
        try {
            return await task();
        } finally {
            this.release(key);
        }
    }
}
