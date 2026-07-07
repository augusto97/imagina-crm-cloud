import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __, _n, sprintf } from '@/lib/i18n';
import type { RecordListMeta } from '@/types/record';

interface PaginationProps {
    meta: RecordListMeta;
    onPageChange: (page: number) => void;
}

export function Pagination({ meta, onPageChange }: PaginationProps): JSX.Element | null {
    if (meta.total_pages <= 1) {
        return (
            <div className="imcrm-text-xs imcrm-text-muted-foreground">
                {sprintf(
                    /* translators: %d: total number of records */
                    _n('%d registro', '%d registros', meta.total),
                    meta.total,
                )}
            </div>
        );
    }

    const start = (meta.page - 1) * meta.per_page + 1;
    const end = Math.min(meta.page * meta.per_page, meta.total);

    return (
        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3">
            <span className="imcrm-text-xs imcrm-text-muted-foreground">
                {sprintf(
                    /* translators: 1: range start, 2: range end, 3: total count */
                    __('%1$d–%2$d de %3$d'),
                    start,
                    end,
                    meta.total,
                )}
            </span>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(Math.max(1, meta.page - 1))}
                    disabled={meta.page <= 1}
                    aria-label={__('Página anterior')}
                >
                    <ChevronLeft className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <span className="imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground imcrm-px-2">
                    {sprintf(
                        /* translators: 1: current page number, 2: total number of pages */
                        __('Página %1$d de %2$d'),
                        meta.page,
                        meta.total_pages,
                    )}
                </span>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(Math.min(meta.total_pages, meta.page + 1))}
                    disabled={meta.page >= meta.total_pages}
                    aria-label={__('Página siguiente')}
                >
                    <ChevronRight className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>
        </div>
    );
}
