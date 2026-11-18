import type {
    IDataObject,
    IExecuteFunctions,
    ILoadOptionsFunctions,
    INodeExecutionData,
    INodePropertyOptions,
    INodeType,
    INodeTypeDescription,
    ResourceMapperFields,
    ResourceMapperValue,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { buildData, fieldToColumn, simplifyRecord, type ApiField, type ApiRecord } from './fields';
import { CREDENTIAL, apiRequest, listRecords, listRef, loadFields } from './transport';

const RECORD_OPS = ['create', 'get', 'getAll', 'update', 'delete'];

async function getLists(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
    const res = (await apiRequest.call(this, 'GET', '/lists')) as { data?: Array<{ id: number; name: string; slug: string }> };
    return (res.data ?? [])
        .map((l) => ({ name: l.name, value: l.id, description: l.slug }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

async function getColumns(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
    const list = this.getNodeParameter('list', 0) as string | number;
    if (!list) return { fields: [] };
    const fields = await loadFields.call(this, list);
    return { fields: fields.map(fieldToColumn).filter((c): c is NonNullable<typeof c> => c !== null) };
}

/**
 * Nodo de acciones: registros (crear, leer, buscar, cambiar, borrar), listas y
 * comentarios, con el token de la API (actúa como la persona que lo creó).
 */
export class ImaginaBase implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Imagina Base',
        name: 'imaginaBase',
        icon: 'file:imaginaBase.svg',
        group: ['transform'],
        version: 1,
        subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
        description: 'Crea, busca y actualiza registros de tus listas',
        defaults: { name: 'Imagina Base' },
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],
        usableAsTool: true,
        credentials: [{ name: CREDENTIAL, required: true }],
        properties: [
            {
                displayName: 'Recurso',
                name: 'resource',
                type: 'options',
                noDataExpression: true,
                options: [
                    { name: 'Registro', value: 'record' },
                    { name: 'Comentario', value: 'comment' },
                    { name: 'Lista', value: 'list' },
                ],
                default: 'record',
            },
            {
                displayName: 'Operación',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                displayOptions: { show: { resource: ['record'] } },
                options: [
                    { name: 'Crear', value: 'create', action: 'Crear un registro', description: 'Crea un registro en una lista' },
                    { name: 'Leer', value: 'get', action: 'Leer un registro', description: 'Trae un registro por su id' },
                    { name: 'Buscar', value: 'getAll', action: 'Buscar registros', description: 'Trae los registros de una lista' },
                    { name: 'Cambiar', value: 'update', action: 'Cambiar un registro', description: 'Cambia sólo los campos que mandas' },
                    { name: 'Borrar', value: 'delete', action: 'Borrar un registro', description: 'Lo manda a la papelera (30 días)' },
                ],
                default: 'create',
            },
            {
                displayName: 'Operación',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                displayOptions: { show: { resource: ['comment'] } },
                options: [
                    { name: 'Agregar', value: 'create', action: 'Agregar un comentario', description: 'Agrega un comentario a un registro' },
                    { name: 'Listar', value: 'getAll', action: 'Listar comentarios', description: 'Trae los comentarios de un registro' },
                ],
                default: 'create',
            },
            {
                displayName: 'Operación',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                displayOptions: { show: { resource: ['list'] } },
                options: [{ name: 'Listar', value: 'getAll', action: 'Listar las listas', description: 'Trae las listas que puedes ver' }],
                default: 'getAll',
            },
            {
                displayName: 'Lista',
                name: 'list',
                type: 'options',
                typeOptions: { loadOptionsMethod: 'getLists' },
                required: true,
                default: '',
                displayOptions: { show: { resource: ['record', 'comment'] } },
                description: 'La lista. En una expresión sirve su ID o su nombre interno.',
            },
            {
                displayName: 'ID del registro',
                name: 'recordId',
                type: 'string',
                required: true,
                default: '',
                displayOptions: { show: { resource: ['record'], operation: ['get', 'update', 'delete'] } },
            },
            {
                displayName: 'ID del registro',
                name: 'recordId',
                type: 'string',
                required: true,
                default: '',
                displayOptions: { show: { resource: ['comment'] } },
            },
            {
                displayName: 'Campos',
                name: 'columns',
                type: 'resourceMapper',
                noDataExpression: true,
                default: { mappingMode: 'defineBelow', value: null },
                required: true,
                typeOptions: {
                    loadOptionsDependsOn: ['list'],
                    resourceMapper: {
                        resourceMapperMethod: 'getColumns',
                        mode: 'add',
                        fieldWords: { singular: 'campo', plural: 'campos' },
                        addAllFields: true,
                        multiKeyMatch: false,
                        supportAutoMap: true,
                    },
                },
                displayOptions: { show: { resource: ['record'], operation: ['create'] } },
            },
            {
                displayName: 'Campos a cambiar',
                name: 'columns',
                type: 'resourceMapper',
                noDataExpression: true,
                default: { mappingMode: 'defineBelow', value: null },
                required: true,
                typeOptions: {
                    loadOptionsDependsOn: ['list'],
                    resourceMapper: {
                        resourceMapperMethod: 'getColumns',
                        mode: 'add',
                        fieldWords: { singular: 'campo', plural: 'campos' },
                        addAllFields: false,
                        multiKeyMatch: false,
                        supportAutoMap: false,
                    },
                },
                displayOptions: { show: { resource: ['record'], operation: ['update'] } },
            },
            {
                displayName: 'Traer todos',
                name: 'returnAll',
                type: 'boolean',
                default: false,
                displayOptions: { show: { operation: ['getAll'], resource: ['record', 'list'] } },
                description: 'Whether to return all results or only up to a given limit',
            },
            {
                displayName: 'Límite',
                name: 'limit',
                type: 'number',
                typeOptions: { minValue: 1 },
                default: 50,
                displayOptions: { show: { operation: ['getAll'], resource: ['record', 'list'], returnAll: [false] } },
                description: 'Max number of results to return',
            },
            {
                displayName: 'Opciones',
                name: 'filters',
                type: 'collection',
                placeholder: 'Agregar opción',
                default: {},
                displayOptions: { show: { resource: ['record'], operation: ['getAll'] } },
                options: [
                    {
                        displayName: 'Buscar',
                        name: 'search',
                        type: 'string',
                        default: '',
                        description: 'Texto a buscar en los campos de texto, correo, enlace, teléfono y la descripción',
                    },
                    {
                        displayName: 'Filtro (JSON)',
                        name: 'filterTree',
                        type: 'json',
                        default: '',
                        description:
                            'Un árbol de filtros como el de la app: {"type":"group","logic":"and","children":[{"type":"condition","field_id":12,"op":"eq","value":"pendiente"}]}',
                    },
                    {
                        displayName: 'Incluir subtareas',
                        name: 'includeSubtasks',
                        type: 'boolean',
                        default: false,
                    },
                ],
            },
            {
                displayName: 'Texto',
                name: 'body',
                type: 'string',
                typeOptions: { rows: 4 },
                required: true,
                default: '',
                displayOptions: { show: { resource: ['comment'], operation: ['create'] } },
            },
            {
                displayName: 'Visible para el cliente',
                name: 'visibleToClient',
                type: 'boolean',
                default: false,
                displayOptions: { show: { resource: ['comment'], operation: ['create'] } },
                description: 'Whether the client sees the comment in their portal. Off = internal note for the team.',
            },
            {
                displayName: 'Simplificar',
                name: 'simplify',
                type: 'boolean',
                default: true,
                displayOptions: { show: { resource: ['record'], operation: RECORD_OPS.filter((o) => o !== 'delete') } },
                description: 'Whether to return each value by the field internal name (on) or the raw record with f{ID} keys (off)',
            },
        ],
    };

    methods = {
        loadOptions: { getLists },
        resourceMapping: { getColumns },
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const out: INodeExecutionData[] = [];
        const fieldsCache = new Map<string, ApiField[]>();
        const fieldsOf = async (list: unknown): Promise<ApiField[]> => {
            const key = String(list);
            let f = fieldsCache.get(key);
            if (!f) {
                f = await loadFields.call(this, list);
                fieldsCache.set(key, f);
            }
            return f;
        };
        const shape = async (list: unknown, rec: ApiRecord, simplify: boolean): Promise<IDataObject> =>
            simplify ? simplifyRecord(rec, await fieldsOf(list)) : (rec as IDataObject);

        for (let i = 0; i < items.length; i++) {
            try {
                const resource = this.getNodeParameter('resource', i) as string;
                const operation = this.getNodeParameter('operation', i) as string;

                if (resource === 'list') {
                    const returnAll = this.getNodeParameter('returnAll', i) as boolean;
                    const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
                    const res = (await apiRequest.call(this, 'GET', '/lists')) as { data?: IDataObject[] };
                    const lists = (res.data ?? []).map((l) => ({ id: l.id, slug: l.slug, name: l.name, group_id: l.group_id ?? null }));
                    for (const l of limit ? lists.slice(0, limit) : lists) out.push({ json: l, pairedItem: { item: i } });
                    continue;
                }

                const list = this.getNodeParameter('list', i) as string | number;

                if (resource === 'comment') {
                    const recordId = String(this.getNodeParameter('recordId', i)).trim();
                    const base = `/lists/${listRef(list)}/records/${encodeURIComponent(recordId)}/comments`;
                    if (operation === 'create') {
                        const body = this.getNodeParameter('body', i) as string;
                        const client = this.getNodeParameter('visibleToClient', i, false) as boolean;
                        const res = (await apiRequest.call(this, 'POST', base, { body, visibility: client ? 'client' : 'internal' })) as IDataObject;
                        out.push({ json: (res.data as IDataObject) ?? res, pairedItem: { item: i } });
                    } else {
                        const res = (await apiRequest.call(this, 'GET', base)) as { data?: IDataObject[] };
                        for (const c of res.data ?? []) out.push({ json: c, pairedItem: { item: i } });
                    }
                    continue;
                }

                // Registros
                const simplify = operation === 'delete' ? false : (this.getNodeParameter('simplify', i, true) as boolean);
                if (operation === 'getAll') {
                    const returnAll = this.getNodeParameter('returnAll', i) as boolean;
                    const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
                    const filters = this.getNodeParameter('filters', i, {}) as { search?: string; filterTree?: string | object; includeSubtasks?: boolean };
                    const qs: IDataObject = {};
                    if (filters.search) qs.search = filters.search;
                    if (filters.includeSubtasks) qs.include_subtasks = 1;
                    if (filters.filterTree) {
                        qs.filter_tree = typeof filters.filterTree === 'string' ? filters.filterTree : JSON.stringify(filters.filterTree);
                    }
                    const recs = await listRecords.call(this, list, limit, qs);
                    for (const r of recs) out.push({ json: await shape(list, r, simplify), pairedItem: { item: i } });
                    continue;
                }

                if (operation === 'create' || operation === 'update') {
                    const mapped = this.getNodeParameter('columns', i) as ResourceMapperValue;
                    let values: Record<string, unknown> | null = mapped?.value ?? null;
                    if (mapped?.mappingMode === 'autoMapInputData') values = items[i]?.json ?? {};
                    const data = buildData(await fieldsOf(list), values, operation);
                    if (operation === 'update' && Object.keys(data).length === 0) {
                        throw new NodeOperationError(this.getNode(), 'No hay campos para cambiar: agrega al menos uno.', { itemIndex: i });
                    }
                    const path =
                        operation === 'create'
                            ? `/lists/${listRef(list)}/records`
                            : `/lists/${listRef(list)}/records/${encodeURIComponent(String(this.getNodeParameter('recordId', i)).trim())}`;
                    const rec = (await apiRequest.call(this, operation === 'create' ? 'POST' : 'PATCH', path, { data })) as ApiRecord;
                    out.push({ json: await shape(list, rec, simplify), pairedItem: { item: i } });
                    continue;
                }

                const recordId = String(this.getNodeParameter('recordId', i)).trim();
                const path = `/lists/${listRef(list)}/records/${encodeURIComponent(recordId)}`;
                if (operation === 'get') {
                    const rec = (await apiRequest.call(this, 'GET', path)) as ApiRecord;
                    out.push({ json: await shape(list, rec, simplify), pairedItem: { item: i } });
                } else if (operation === 'delete') {
                    await apiRequest.call(this, 'DELETE', path);
                    out.push({ json: { id: Number(recordId) || recordId, deleted: true }, pairedItem: { item: i } });
                }
            } catch (error) {
                if (this.continueOnFail()) {
                    out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
                    continue;
                }
                throw error;
            }
        }
        return [out];
    }
}
