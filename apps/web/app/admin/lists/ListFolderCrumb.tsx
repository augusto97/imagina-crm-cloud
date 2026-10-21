import { Link } from 'react-router';

import { useListGroups } from '@/hooks/useListGroups';

/**
 * v0.1.286 — el tramo de la CARPETA en el breadcrumb de una lista
 * ("Listas / Ventas / Clientes"), enlazado al espacio de la carpeta. Sin
 * carpeta no dibuja nada. Las carpetas ya están en cache (el panel las usa).
 */
export function ListFolderCrumb({ groupId }: { groupId: number | null | undefined }): JSX.Element | null {
    const groups = useListGroups();
    if (groupId === null || groupId === undefined) return null;
    const group = groups.data?.find((g) => g.id === groupId);
    if (!group) return null;
    return (
        <>
            <Link
                to={`/folders/${group.id}`}
                className="imcrm-min-w-0 imcrm-max-w-[30%] imcrm-truncate imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-text-foreground"
                data-testid="breadcrumb-folder"
            >
                {group.name}
            </Link>
            <span aria-hidden className="imcrm-shrink-0 imcrm-text-muted-foreground">
                /
            </span>
        </>
    );
}
