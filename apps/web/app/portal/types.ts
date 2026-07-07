/**
 * Tipos compartidos del bundle del portal del cliente (Fase 9 — 3.D).
 *
 * Espejan los shapes que emite el `PortalController` y `PortalShortcode`
 * server-side. Estables — cambios deben coordinarse con el PHP.
 */

export interface PortalBootData {
    rest_root: string;
    rest_nonce: string;
    list_slug: string;
    user_id: number;
    record_id: number;
}

export interface PortalRecord {
    id: number;
    fields: Record<string, unknown>;
    relations: Record<string, unknown>;
}

export interface PortalListMeta {
    id: number;
    slug: string;
    name: string;
}

export interface PortalUserMeta {
    id: number;
    display_name: string;
    email: string;
}

/**
 * Posicionamiento opcional en grid 12-col. Aditivo a `PortalBlock`
 * (intersection abajo). Si los campos están ausentes, el renderer
 * cae a layout vertical full-width (backward-compat).
 */
export interface PortalBlockGridPosition {
    id?: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    pos?: number;
    /** Spacing CSS de la sección/columna (consistente entre bloques hermanos). */
    secPadding?: string;
    secMargin?: string;
    colPadding?: string;
    colMargin?: string;
}

export type PortalBlock = PortalBlockGridPosition & (
    | {
          type: 'static_text';
          config: {
              html?: string;
              title?: string;
              /** `card` (default) envuelve el contenido en un card con
               *  border + bg. `plain` lo renderea directo, sin marco.
               *  `bordered_left` card con border-left de acento. */
              variant?: 'card' | 'plain' | 'bordered_left';
              accent_color?: string | null;
          };
      }
    | {
          type: 'client_data';
          config: {
              visible_field_slugs?: string[];
              title?: string;
              /** `definition_list` (default) muestra label izquierda /
               *  valor derecha en una `<dl>` densa. `cards` muestra un
               *  grid 2-col con cada campo en su propia card. */
              variant?: 'definition_list' | 'cards';
          };
      }
    | {
          type: 'related_records_table';
          config: {
              list_slug?: string;
              visible_field_slugs?: string[];
              title?: string;
              per_page?: number;
              /** `table` (default) muestra tabla completa con todas las
               *  columnas. `compact_list` muestra solo el primer campo
               *  como título + un meta de los demás abajo (apto mobile). */
              variant?: 'table' | 'compact_list';
          };
      }
    // Fase 9 — 3.E
    | {
          type: 'editable_form';
          config: {
              editable_field_slugs?: string[];
              title?: string;
              submit_label?: string;
          };
      }
    | {
          type: 'external_link';
          config: {
              title?: string;
              description?: string;
              href?: string;
              label?: string;
              new_window?: boolean;
              /** `button` (default) botón centrado solo con label.
               *  `card_cta` card con icono + título + descripción + label.
               *  `hero_cta` banner full-width con título grande + CTA. */
              variant?: 'button' | 'card_cta' | 'hero_cta';
              /** Hex (`#rrggbb`) que override el primary del tema para el
               *  bg del botón / borde del card. Default: primary del CSS. */
              accent_color?: string | null;
          };
      }
    | {
          type: 'kpi_widget';
          config: {
              title?: string;
              list_slug?: string;
              field_id?: number;
              metric?: 'count' | 'sum' | 'avg' | 'min' | 'max';
              suffix?: string;
              prefix?: string;
              /** `card` (default) número grande con label. `inline`
               *  label + valor en línea horizontal. */
              variant?: 'card' | 'inline';
              accent_color?: string | null;
              icon?: string;
              trend_text?: string;
              trend_direction?: 'up' | 'down' | 'neutral';
          };
      }
    // Fase 9 — pulidos
    | {
          type: 'activity_timeline';
          config: {
              title?: string;
              limit?: number;
          };
      }
    | {
          type: 'download_files';
          config: {
              title?: string;
              field_slug?: string;
              /** `list` (default) lista vertical de archivos. `grid`
               *  grid 3-col con icono + nombre debajo. */
              variant?: 'list' | 'grid';
          };
      }
    // Fase 12.D
    | {
          type: 'comments_thread';
          config: {
              title?: string;
              /** Solo lectura: cliente ve pero no puede crear comments. */
              readonly?: boolean;
          };
      }
    // 0.57.0 — bloques de UX/jerarquía visual
    | {
          type: 'heading';
          config: {
              text?: string;
              eyebrow?: string;
              level?: 1 | 2 | 3;
              align?: 'left' | 'center';
              accent_color?: string | null;
          };
      }
    | {
          type: 'hero';
          config: {
              title?: string;
              subtitle?: string;
              cta_label?: string;
              cta_href?: string;
              variant?: 'gradient' | 'solid' | 'plain';
              accent_color?: string | null;
              /** Override del bg del variant. Si está seteado, gradient/solid se reemplazan por bg sólido. */
              background_color?: string | null;
              /** Override del color del texto. Default: white para gradient/solid, heredado para plain. */
              text_color?: string | null;
              align?: 'left' | 'center';
          };
      }
    | {
          type: 'stats_grid';
          config: {
              title?: string;
              items?: Array<{
                  label: string;
                  value?: string;
                  metric: 'static' | 'count' | 'sum' | 'avg' | 'min' | 'max';
                  list_slug?: string;
                  field_id?: number;
                  prefix?: string;
                  suffix?: string;
              }>;
              columns?: 2 | 3 | 4;
          };
      }
    | {
          type: 'quick_actions';
          config: {
              title?: string;
              items?: Array<{
                  icon: string;
                  label: string;
                  href: string;
                  new_window?: boolean;
              }>;
              columns?: 2 | 3 | 4;
          };
      }
    | {
          type: 'notice';
          config: {
              title?: string;
              body?: string;
              variant?: 'info' | 'success' | 'warning' | 'error' | 'announce';
              cta_label?: string;
              cta_href?: string;
              dismissible?: boolean;
          };
      }
    | {
          type: 'divider';
          config: {
              label?: string;
              style?: 'solid' | 'dashed' | 'dotted';
          };
      }
    | {
          type: 'faq';
          config: {
              title?: string;
              items?: Array<{
                  question: string;
                  answer: string;
              }>;
          };
      }
    | {
          type: 'contact_card';
          config: {
              title?: string;
              name?: string;
              role?: string;
              avatar_url?: string;
              email?: string;
              phone?: string;
              whatsapp?: string;
          };
      }
    | {
          /**
           * Sub-sección con N columnas anidadas. Cada columna contiene
           * un array de sub-bloques apilados verticalmente. Soporta
           * 1 nivel de anidamiento (los sub-bloques NO pueden ser
           * a su vez `nested_section`).
           */
          type: 'nested_section';
          config: {
              columns: Array<{
                  id: string;
                  /** Ancho en cols de 12 (1-12). */
                  width: number;
                  /** Sub-bloques apilados verticalmente. */
                  blocks: PortalBlock[];
              }>;
          };
      }
);

/**
 * Metadata de un field de la lista del portal — emitido por
 * `GET /portal/me`. Lo usan los bloques (`client_data`, `editable_form`,
 * `related_records_table`) para renderear values con sus labels
 * correctos, opciones de select traducidas, fechas formateadas, etc.
 */
export interface PortalFieldMeta {
    slug: string;
    label: string;
    type: string;
    config: Record<string, unknown>;
}

export interface PortalMeResponse {
    data: {
        list: PortalListMeta;
        record: PortalRecord;
        /** Metadata de fields de la lista del portal (post-permission sanitizer). */
        fields?: PortalFieldMeta[];
        user: PortalUserMeta;
        template: { blocks: PortalBlock[] };
    };
}

export interface PortalRecordsResponse {
    data: PortalRecord[];
    meta: {
        page: number;
        per_page: number;
        total: number;
        total_pages: number;
    };
}
