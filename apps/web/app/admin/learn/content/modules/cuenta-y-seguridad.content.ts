import type { LearnArticle } from '../types';

export const articles: LearnArticle[] = [
    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cuenta-y-seguridad-menu',
        route: '/settings?s=apariencia',
        related: ['cuenta-y-seguridad-contrasena', 'cuenta-y-seguridad-avisos'],
        blocks: [
            {
                t: 'p',
                md: 'Todo lo que es **tuyo** —no de la empresa— está a un clic: en el **círculo con tus iniciales**, arriba a la derecha. Ese menú es el mismo para todos los roles, y desde ahí llegas a tu seguridad, a tus avisos, al modo claro u oscuro y a cerrar sesión. En el celular y en la app instalada está en la pestaña **Más**, abajo a la derecha, con lo mismo en filas grandes. Lo que cambies aquí sólo te afecta a ti: tu equipo no lo ve.',
            },
            {
                t: 'anim',
                key: 'cuenta-menu',
                caption: 'El menú de tu avatar: tu empresa, Ajustes, el modo oscuro, instalar la app y cerrar sesión.',
            },
            { t: 'h', text: 'Qué hay en el menú' },
            {
                t: 'settings',
                title: 'El menú de tu cuenta',
                rows: [
                    {
                        name: 'Empresa',
                        what: 'Si trabajas con más de una empresa (por ejemplo, eres contador de varias), aquí cambias de una a otra sin cerrar sesión.',
                        tip: 'Cada empresa tiene sus propias listas, permisos y avisos.',
                    },
                    {
                        name: 'Mi cuenta / Ajustes',
                        what: 'Abre tus ajustes personales: **Seguridad**, **Avisos**, **Firma de email**, **Tus datos** y **Apariencia**. Si eres admin, también los de la empresa.',
                        tip: 'Los ajustes de la empresa sólo aparecen si tu rol puede cambiarlos.',
                    },
                    {
                        name: 'Novedades',
                        what: 'Lo nuevo de cada versión de la app, con un contador de lo que no has visto.',
                        tip: 'También está en el megáfono de la barra superior.',
                    },
                    {
                        name: 'Modo claro / Modo oscuro',
                        what: 'Cambia el aspecto de la app al instante.',
                        tip: 'Es por dispositivo: puedes tener el computador en claro y el celular en oscuro.',
                    },
                    {
                        name: 'Instalar la app',
                        what: 'La deja en tu teléfono o computador como una aplicación más.',
                        tip: 'Así se abre en su propia ventana y te avisa aunque esté cerrada.',
                    },
                    {
                        name: 'Primeros pasos / Atajos de teclado',
                        what: 'La lista para arrancar y los atajos para moverte más rápido.',
                        tip: 'Pulsa **?** en cualquier pantalla para ver los atajos.',
                    },
                    {
                        name: 'Cerrar sesión',
                        what: 'Sale de la app en este dispositivo.',
                        tip: 'Ciérrala siempre en un computador compartido.',
                    },
                ],
            },
            { t: 'h', text: 'Modo claro, oscuro o el del sistema' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes → Apariencia** (o toca el sol/luna de la barra superior para cambiar rápido).',
                    'Elige **Claro** (la interfaz de siempre), **Oscuro** (superficies oscuras, menos brillo) o **Seguir al sistema** (usa el modo de tu dispositivo y cambia solo si tu teléfono pasa a oscuro de noche).',
                    'El cambio se aplica al instante y se recuerda en ese dispositivo.',
                ],
            },
            {
                t: 'demo',
                key: 'cuenta-apariencia',
                caption: 'Ajustes → Apariencia: elegir entre claro, oscuro o el del sistema.',
                fallback: 'cuenta-menu',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Los colores de tu empresa se adaptan solos',
                md: 'Si tu empresa eligió su color y su logo, en modo oscuro el color se aclara un poco para que se lea bien. No tienes que hacer nada.',
            },
            { t: 'h', text: 'Instalar la app en tu teléfono o computador' },
            {
                t: 'p',
                md: 'La app funciona en el navegador, pero instalada es más cómoda: queda con tus aplicaciones, se abre en su propia ventana y puede mandarte notificaciones aunque esté cerrada. En el menú de tu avatar toca **Instalar la app**. Si tu navegador lo permite con un clic (Chrome o Edge), se instala al instante; si no (Safari, iPhone), te muestra los pasos exactos para tu navegador, por ejemplo **Compartir → Agregar a inicio** en el iPhone. También está en **Ajustes → Avisos**, en la tarjeta **App en este dispositivo**.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Puedo cambiar mi nombre o mi correo?',
                        a: 'Tu nombre y tu correo los usa tu equipo para encontrarte y asignarte trabajo. Si necesitas cambiarlos, pídeselo a un admin de tu empresa.',
                    },
                    {
                        q: 'No veo «Instalar la app» en el menú.',
                        a: 'Seguramente ya la estás usando instalada: en ese caso la opción desaparece.',
                    },
                    {
                        q: '¿El modo oscuro gasta menos batería?',
                        a: 'En pantallas OLED (la mayoría de los celulares actuales), sí, un poco. Sobre todo cansa menos la vista de noche.',
                    },
                ],
            },
            {
                t: 'example',
                title: 'Ejemplo: un asesor que trabaja con dos empresas',
                md: 'Camilo es asesor contable de Café Aurora y de Ferretería El Sol. Entra una sola vez, con un solo correo y una sola contraseña. En el menú de su avatar, en **Empresa**, cambia de una a otra: cada una tiene sus listas, su campana y sus avisos. Prefiere el modo oscuro en el portátil y el claro en el celular, y la app recuerda cada uno.',
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Apariencia', to: '/settings?s=apariencia' },
                    { label: 'Ver cómo instalar la app', tour: 'install-app' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cuenta-y-seguridad-contrasena',
        route: '/settings?s=seguridad',
        related: ['cuenta-y-seguridad-2fa', 'cuenta-y-seguridad-tus-datos'],
        blocks: [
            {
                t: 'p',
                md: 'Tu cuenta abre los datos de tu empresa: clientes, facturas, contratos. Cuidarla es lo más importante que puedes hacer por la seguridad de tu equipo. En **Ajustes → Seguridad** está todo: tu contraseña, los dispositivos donde está abierta tu cuenta, la verificación en dos pasos y la confirmación de tu correo.',
            },
            {
                t: 'anim',
                key: 'cuenta-sessions',
                caption: 'En «Dispositivos conectados» ves cada computador y teléfono donde está abierta tu cuenta, y cierras el que no reconoces.',
            },
            { t: 'h', text: 'Cambiar tu contraseña' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes → Seguridad**.',
                    'En **Contraseña** escribe tu **Contraseña actual**, la **Contraseña nueva** (mínimo 8 caracteres) y repítela en **Repetir la nueva**.',
                    'Toca **Cambiar contraseña**. Verás «Contraseña actualizada» y cuántas sesiones se cerraron.',
                    'Al cambiarla se cierran las sesiones de tus **otros** dispositivos. La que estás usando sigue abierta.',
                ],
            },
            {
                t: 'demo',
                key: 'cuenta-seguridad',
                caption: 'Ajustes → Seguridad: contraseña y dispositivos conectados.',
                fallback: 'cuenta-sessions',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Una buena contraseña',
                md: 'Larga y única: mejor una frase como «cafe-de-origen-en-medellin-2026» que una palabra corta con símbolos. Y que no sea la misma de tu correo ni de tu banco. Un gestor de contraseñas (el de tu navegador, 1Password, Bitwarden) la recuerda por ti.',
            },
            { t: 'h', text: 'Dispositivos conectados' },
            {
                t: 'p',
                md: 'Debajo de la contraseña, **Dispositivos conectados** muestra dónde está abierta tu cuenta: el navegador, el sistema, la dirección desde donde se conectó y la **última actividad**. El tuyo aparece marcado como **este dispositivo**.\n\nSi ves algo que no reconoces —un Windows cuando usas Mac, una ciudad donde no estuviste—, toca **Cerrar** en esa fila y cambia tu contraseña de inmediato. Si dejaste la sesión abierta en un computador prestado, **Cerrar las demás** cierra todo menos el dispositivo que tienes en la mano.',
            },
            {
                t: 'settings',
                title: 'Qué ves en cada sesión',
                rows: [
                    {
                        name: 'Navegador y sistema',
                        what: 'Por ejemplo «Chrome en Windows» o «Safari en iPhone».',
                        tip: 'La app instalada en el teléfono aparece como el navegador con el que se instaló.',
                    },
                    {
                        name: 'Última actividad',
                        what: 'Cuándo se usó por última vez esa sesión.',
                        tip: 'Una sesión que no se usa durante 30 días se cierra sola.',
                    },
                    {
                        name: 'soporte',
                        what: 'Marca una sesión abierta por el equipo de soporte de la plataforma para ayudarte.',
                        tip: 'Si no pediste ayuda y ves una, avísale a un admin.',
                    },
                ],
            },
            { t: 'h', text: 'Si olvidas tu contraseña' },
            {
                t: 'steps',
                items: [
                    'En la pantalla de entrada toca **¿Olvidaste tu contraseña?** y escribe tu correo.',
                    'Te llega un enlace para crear una nueva. Vence en **30 minutos** y sirve una sola vez.',
                    'Al crear la nueva, se cierran todas tus sesiones abiertas: si alguien se había metido con tu contraseña, queda afuera.',
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Demasiados intentos',
                md: 'Si alguien escribe mal tu contraseña muchas veces seguidas (10 en 15 minutos), la app frena los intentos en tu cuenta por un rato, aunque vengan de distintos lugares. Si fuiste tú, espera o recupera la contraseña: al crear una nueva, el freno se levanta.',
            },
            { t: 'h', text: 'Confirmar tu correo' },
            {
                t: 'p',
                md: 'Si creaste tu cuenta registrándote tú mismo, te llega un correo para confirmar tu dirección. Mientras no lo hagas, verás el aviso **Confirma tu dirección de correo** arriba de la app y en **Ajustes → Seguridad**, con el botón **Reenviar el correo**. Confirmarlo sirve para recuperar tu cuenta y recibir avisos importantes. Si te invitaron, ya está confirmado: el enlace de la invitación llegó a tu casilla.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: 'Cambié la contraseña y me sacó del celular.',
                        a: 'Es lo esperado: cambiar la contraseña cierra las sesiones de los otros dispositivos. Vuelve a entrar en el celular con la nueva.',
                    },
                    {
                        q: 'No me llega el correo para recuperar la contraseña.',
                        a: 'Revisa spam y que el correo esté bien escrito. Si sigue sin llegar, pídele a un admin de tu empresa que te reenvíe la invitación o te ayude.',
                    },
                    {
                        q: '¿Un admin puede ver mi contraseña?',
                        a: 'No. Nadie puede verla, ni siquiera el soporte de la plataforma: se guarda de forma que no se puede leer.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Seguridad', to: '/settings?s=seguridad' },
                    {
                        label: 'Activar la verificación en dos pasos',
                        article: 'cuenta-y-seguridad-2fa',
                    },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cuenta-y-seguridad-2fa',
        route: '/settings?s=seguridad',
        related: ['cuenta-y-seguridad-contrasena', 'cuenta-y-seguridad-tus-datos'],
        blocks: [
            {
                t: 'p',
                md: 'Con la **verificación en dos pasos**, entrar a tu cuenta pide dos cosas: tu contraseña y un código de 6 dígitos que cambia cada 30 segundos en una app de tu teléfono. Si alguien roba o adivina tu contraseña, no le alcanza: le falta tu teléfono. Es la medida de seguridad que más protege, y toma dos minutos activarla.\n\nRecomendada para todos, e imprescindible para los **admins** y para quien maneja facturación o datos sensibles.',
            },
            {
                t: 'anim',
                key: 'cuenta-2fa',
                caption: 'Escaneas el código QR con tu app de autenticación, escribes el código que muestra y guardas tus códigos de respaldo.',
            },
            { t: 'h', text: 'Qué necesitas' },
            {
                t: 'p',
                md: 'Una app de autenticación en tu celular: **Google Authenticator**, **Microsoft Authenticator**, **1Password**, **Authy** o la que ya uses. Son gratis. No necesitas señal ni datos para que funcionen.',
            },
            { t: 'h', text: 'Activarla paso a paso' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes → Seguridad** y busca **Verificación en dos pasos**. Toca **Activar**.',
                    'En **1. Escanea el código con tu app** abre tu app de autenticación, toca agregar una cuenta y escanea el código QR. Si no puedes escanear, toca **Copiar la clave** y cárgala a mano.',
                    'En **2. Escribe el código que muestra** escribe los 6 dígitos que aparecen en la app y confirma.',
                    'Aparece **Guarda estos códigos de respaldo**: diez códigos que sirven UNA vez cada uno para entrar si pierdes el teléfono. Toca **Copiar los códigos** y guárdalos en un lugar seguro (tu gestor de contraseñas, impresos en un cajón). No se vuelven a mostrar.',
                    'Toca **Ya los guardé**. Desde ahora, al entrar te pedirá el código después de la contraseña.',
                ],
            },
            {
                t: 'demo',
                key: 'cuenta-2fa',
                caption: 'Activar la verificación en dos pasos: el código QR y el código de la app.',
                fallback: 'cuenta-2fa',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Guarda los códigos de respaldo de verdad',
                md: 'Si pierdes el teléfono y no tienes los códigos de respaldo, no podrás entrar. Guárdalos lejos del celular: si te roban el teléfono, no quieres que los códigos estén ahí mismo.',
            },
            { t: 'h', text: 'Cómo es entrar con dos pasos' },
            {
                t: 'p',
                md: 'Escribes tu correo y tu contraseña como siempre. Luego la app te pide: «Ingresa el código de 6 dígitos de tu app de autenticación». Abres la app, copias el número y listo. Si no tienes el teléfono a mano, escribe uno de tus códigos de respaldo en el mismo lugar: se gasta y no vuelve a servir.',
            },
            {
                t: 'settings',
                title: 'Lo que puedes hacer con la verificación activa',
                rows: [
                    {
                        name: 'Códigos de respaldo sin usar',
                        what: 'Cuántos te quedan de los diez.',
                        tip: 'Si te quedan pocos, genera nuevos.',
                    },
                    {
                        name: 'Generar códigos nuevos',
                        what: 'Crea diez códigos nuevos y anula los anteriores.',
                        tip: 'Hazlo también si crees que alguien vio los anteriores.',
                    },
                    {
                        name: 'Desactivar',
                        what: 'Quita la verificación en dos pasos. Te pide tu contraseña para confirmar.',
                        tip: 'Antes de cambiar de teléfono, no hace falta desactivarla: mira la pregunta de abajo.',
                    },
                ],
            },
            {
                t: 'example',
                title: 'Ejemplo: la gerente que cambió de celular',
                md: 'Marcela, gerente de una distribuidora en Cali, cambió de celular. Antes de borrar el viejo, abrió su app de autenticación y usó la opción de transferir cuentas al teléfono nuevo. Si no hubiera podido, habría entrado con uno de sus códigos de respaldo, desactivado la verificación y vuelto a activarla escaneando el código con el teléfono nuevo.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: 'Perdí el teléfono y no tengo los códigos de respaldo.',
                        a: 'Pídele ayuda a un admin de tu empresa o al soporte de la plataforma: tendrán que verificar que eres tú antes de devolverte el acceso.',
                    },
                    {
                        q: 'El código siempre dice que no coincide.',
                        a: 'Revisa que la hora del teléfono esté en automático: los códigos dependen del reloj. Y que estés usando la cuenta correcta en la app, si tienes varias.',
                    },
                    {
                        q: '¿Tengo que poner el código cada vez que abro la app?',
                        a: 'No. Sólo al iniciar sesión. Mientras tu sesión siga abierta en ese dispositivo, no te lo vuelve a pedir.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [{ label: 'Activar en Seguridad', to: '/settings?s=seguridad' }],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cuenta-y-seguridad-avisos',
        route: '/settings?s=avisos',
        related: ['cuenta-y-seguridad-menu', 'cuenta-y-seguridad-firma'],
        blocks: [
            {
                t: 'p',
                md: 'Todo lo importante te llega a la **campana** de la barra superior: alguien te mencionó, te asignaron un registro, comentaron algo que sigues, se cumplió un recordatorio. Además, puedes recibir cada tipo de aviso **por correo** o como **notificación del teléfono o el computador**. En **Ajustes → Avisos** decides qué te llega y por dónde. Es tuyo y por empresa: si trabajas con dos, cada una tiene su configuración.',
            },
            {
                t: 'anim',
                key: 'cuenta-avisos',
                caption: 'Una fila por tipo de aviso, con una casilla para el correo y otra para las notificaciones del teléfono.',
            },
            { t: 'h', text: 'Elegir qué te llega' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes → Avisos**.',
                    'En **Qué te llega, y por dónde** marca o desmarca cada tipo en las columnas **Correo** y **Push**. La campana siempre recibe todo.',
                    'Los cambios se guardan solos (verás «Guardado»).',
                ],
            },
            {
                t: 'settings',
                title: 'Los tipos de aviso más comunes',
                rows: [
                    {
                        name: 'Te mencionan',
                        what: 'Alguien escribió @tu nombre en un comentario o en una descripción.',
                        tip: 'Conviene dejarlo por correo y push: suelen pedirte algo.',
                    },
                    {
                        name: 'Te asignan un registro',
                        what: 'Te pusieron de responsable de una oportunidad, un ticket o una tarea.',
                        tip: 'Imprescindible para vendedores y personal de soporte.',
                    },
                    {
                        name: 'Comentan / Cambia un registro que sigues',
                        what: 'Movimiento en registros que creaste, comentaste o seguiste con el botón «Seguir».',
                        tip: 'Con muchos registros, mejor sólo en la campana.',
                    },
                    {
                        name: 'Tus recordatorios',
                        what: 'Los «Recordarme» que pusiste en un registro.',
                        tip: 'Ideal como notificación del teléfono.',
                    },
                    {
                        name: 'Algo dejó de funcionar',
                        what: 'Una automatización, un conector o el correo de la empresa fallaron.',
                        tip: 'Para admins: mejor por correo para enterarse rápido.',
                    },
                    {
                        name: 'Aprobaciones',
                        what: 'Te piden aprobar algo, o resolvieron algo que pediste.',
                        tip: 'El correo trae botones que te llevan directo a aprobar o rechazar.',
                    },
                ],
            },
            {
                t: 'demo',
                key: 'cuenta-avisos',
                caption: 'Ajustes → Avisos: qué te llega por correo, qué por notificación y el resumen diario.',
                fallback: 'cuenta-avisos',
            },
            { t: 'h', text: 'Notificaciones en el teléfono o el computador' },
            {
                t: 'steps',
                items: [
                    'En **Ajustes → Avisos**, en la tarjeta **Notificaciones en este dispositivo**, toca **Activar en este dispositivo**. El navegador te pide permiso: acéptalo.',
                    'Toca **Enviarme una prueba** para comprobar que llega.',
                    'Repítelo en cada dispositivo donde quieras recibirlas (el celular, el computador de la oficina).',
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'En iPhone, primero instala la app',
                md: 'En iPhone y iPad las notificaciones sólo funcionan con la app instalada en la pantalla de inicio (iOS 16.4 o más nuevo). Toca **Instalar la app** en el menú de tu avatar y sigue los pasos. Si bloqueaste las notificaciones sin querer, la tarjeta te dice cómo desbloquearlas en tu navegador.',
            },
            { t: 'h', text: 'El resumen diario' },
            {
                t: 'p',
                md: 'Si prefieres no recibir correos sueltos, activa **Resumen diario por correo**: un solo correo con lo vencido, lo que vence hoy y los avisos sin leer, a la hora que elijas (**A las**) y en los **Días** que quieras. Se manda en la hora de la empresa, y si no hay nada pendiente, no llega.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Sin avalancha de correos',
                md: 'Llegan como mucho 10 correos de avisos por hora: si alguien hace un cambio masivo que te afecta, el resto queda sólo en la campana. Con las notificaciones del teléfono pasa lo mismo, con su propio tope.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Puedo silenciar todo un rato?',
                        a: 'Desmarca las columnas de correo y push: la campana sigue juntando todo y lo revisas cuando quieras.',
                    },
                    {
                        q: 'No me llegan las notificaciones del teléfono.',
                        a: 'Revisa que el modo «No molestar» esté apagado, que las notificaciones de tu navegador o de la app estén permitidas en el sistema, y prueba con **Enviarme una prueba**.',
                    },
                    {
                        q: '¿Los avisos de una empresa me llegan en la otra?',
                        a: 'No. Cada empresa tiene su campana y su configuración de avisos.',
                    },
                ],
            },
            {
                t: 'example',
                title: 'Ejemplo: una asesora de ventas',
                md: 'Daniela deja por correo y por notificación **Te mencionan**, **Te asignan un registro** y **Tus recordatorios**; los comentarios de registros que sigue, sólo en la campana. Activa el **Resumen diario** a las 7:00 de lunes a viernes: antes de salir a ruta ya sabe qué vence hoy.',
            },
            {
                t: 'actions',
                items: [
                    { label: 'Abrir Avisos', to: '/settings?s=avisos' },
                    { label: 'Instalar la app', tour: 'install-app' },
                ],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cuenta-y-seguridad-firma',
        route: '/settings?s=firma',
        related: ['cuenta-y-seguridad-avisos'],
        blocks: [
            {
                t: 'p',
                md: 'Cuando una automatización manda un correo «de tu parte» —un seguimiento a un cliente, la confirmación de un pedido—, puede llevar **tu firma** al final, como cuando escribes desde tu correo. La firma se arma una vez en **Ajustes → Firma de email** y se actualiza sola en todos los correos: si cambias de cargo o de teléfono, sólo la editas ahí.',
            },
            {
                t: 'anim',
                key: 'cuenta-firma',
                caption: 'Armas la firma con formato y la vista previa muestra cómo queda al final del correo.',
            },
            { t: 'h', text: 'Armar tu firma' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes → Firma de email**.',
                    'En el modo **Visual**, escribe tu firma como en un correo: tu nombre en negrita, tu cargo, la empresa, el teléfono, el sitio web. Puedes poner color, enlaces y una imagen (el logo).',
                    'Mira la **Vista previa** para ver cómo queda.',
                    'Toca **Guardar firma**.',
                ],
            },
            {
                t: 'settings',
                title: 'Las dos formas de editarla',
                rows: [
                    {
                        name: 'Visual',
                        what: 'Un editor como el de tu correo: negrita, color, enlaces e imagen.',
                        tip: 'La forma recomendada para casi todos.',
                    },
                    {
                        name: 'HTML',
                        what: 'Para pegar una firma ya diseñada (por ejemplo, la que te dio el área de marketing).',
                        tip: 'Si tu firma tiene tablas, se abre directo en este modo para no simplificarla.',
                    },
                ],
            },
            { t: 'h', text: 'Que aparezca en los correos' },
            {
                t: 'p',
                md: 'La firma no se agrega sola a todo: en cada automatización, en la acción **Enviar email**, quien la arma marca **Agregar la firma al final del correo** y elige **Firma de** (la tuya o la de otra persona del equipo). La firma se lee en el momento de enviar, así que siempre sale la versión más reciente.',
            },
            {
                t: 'example',
                title: 'Ejemplo: firma de una asesora comercial',
                md: '**Valentina Ríos**\nAsesora comercial · Café Aurora\n+57 300 123 4567 · cafeaurora.co\n\nCon esa firma guardada, el correo «Tu pedido salió a ruta» que manda la automatización de pedidos termina con los datos de Valentina, y si el cliente responde, sabe a quién llamar.',
            },
            {
                t: 'callout',
                tone: 'tip',
                title: 'Imágenes livianas',
                md: 'Si pones el logo, usa una imagen pequeña (de unos 150 a 200 píxeles de ancho). Las imágenes grandes hacen que el correo pese más y algunos lectores de correo las ocultan.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Mi firma se usa en los correos que mando desde mi Gmail?',
                        a: 'No. Esta firma es para los correos que manda la app. La de tu Gmail u Outlook se configura en tu correo.',
                    },
                    {
                        q: 'Me fui de la empresa, ¿qué pasa con mi firma?',
                        a: 'Si una automatización usaba tu firma y ya no eres del equipo, el correo sale igual, sin firma, y queda anotado en su historial.',
                    },
                ],
            },
            { t: 'h', text: 'Qué poner en una buena firma' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'UserCheck',
                        title: 'Quién eres',
                        md: 'Tu nombre en negrita y tu cargo. Así el cliente sabe a quién responder.',
                        tone: 'blue',
                    },
                    {
                        icon: 'Phone',
                        title: 'Cómo contactarte',
                        md: 'Un teléfono o WhatsApp y el sitio web. Evita poner muchos: uno o dos bastan.',
                        tone: 'mint',
                    },
                    {
                        icon: 'Image',
                        title: 'Tu marca',
                        md: 'El logo pequeño y, si quieres, un color de la empresa en tu nombre.',
                        tone: 'violet',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'La firma la ve quien recibe el correo',
                md: 'No pongas datos que no quieras que vea un cliente, como tu número personal o un correo interno. La firma sale tal cual en cada correo que la incluya.',
            },
            {
                t: 'example',
                title: 'Ejemplo: una firma para todo el equipo de soporte',
                md: 'En una mesa de ayuda, cada agente arma su firma con su nombre, «Soporte técnico · Ferretería El Sol» y el WhatsApp de soporte. La automatización «Responder por correo» de cada ticket usa la firma de quien lo tiene asignado, así el cliente ve siempre el nombre de la persona que lo está atendiendo y sabe a quién escribir si necesita algo más.',
            },
            {
                t: 'actions',
                items: [{ label: 'Abrir Firma de email', to: '/settings?s=firma' }],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cuenta-y-seguridad-conexiones',
        route: '/settings?s=seguridad',
        related: ['cuenta-y-seguridad-contrasena', 'cuenta-y-seguridad-tus-datos'],
        blocks: [
            {
                t: 'p',
                md: 'Si usas **Claude** (en claude.ai, en la app de escritorio o en el celular), **Cursor** u otro asistente de IA, puedes conectarlo a tu cuenta para pedirle cosas como «¿cuántas facturas vencidas tiene Ferretería El Sol?» o «crea una lista de proveedores con estos campos». El asistente trabaja con **tus mismos permisos**: no ve nada que tú no veas, y lo que cambie te lo **propone** primero para que lo confirmes.\n\nTodo se maneja en **Ajustes → Seguridad**, en la tarjeta **Conexión MCP (Claude, Cursor y otros)**.',
            },
            {
                t: 'anim',
                key: 'cuenta-mcp',
                caption: 'Pegas la dirección en Claude, autorizas en la app eligiendo la empresa y el alcance, y ya puedes preguntarle por tus datos.',
            },
            { t: 'h', text: 'Conectar Claude sin copiar claves' },
            {
                t: 'steps',
                items: [
                    'En **Ajustes → Seguridad → Conexión MCP**, toca **Copiar URL** en «Conectar desde claude.ai, Claude Desktop o el celular».',
                    'En Claude ve a **Ajustes → Conectores → Agregar conector personalizado**, pega la dirección y toca **Conectar**.',
                    'Claude te trae a una pantalla de la app: elige la **empresa** y el **alcance** y toca **Autorizar**.',
                    'Listo. La conexión aparece en la tarjeta como **Conexión autorizada · se renueva sola**.',
                ],
            },
            {
                t: 'settings',
                title: 'Al crear una conexión',
                rows: [
                    {
                        name: 'Alcance: Sólo lectura',
                        what: 'El asistente consulta listas y registros, pero no puede proponer cambios.',
                        tip: 'Perfecto para preguntas, reportes y resúmenes.',
                    },
                    {
                        name: 'Alcance: Lectura y cambios',
                        what: 'Además, propone cambios (crear registros, armar una vista, una automatización) que se aplican sólo cuando tú confirmas.',
                        tip: 'Nunca puede más que tu rol: si eres Lector, igual sólo lee.',
                    },
                    {
                        name: 'Vence en',
                        what: 'Para un token que pegas a mano: 7, 30, 90, 365 días o nunca.',
                        tip: 'Ponle vencimiento a los que uses para pruebas.',
                    },
                    {
                        name: 'Revocar',
                        what: 'Corta el acceso al instante.',
                        tip: 'Hazlo si ya no usas esa conexión o si perdiste el equipo donde estaba.',
                    },
                ],
            },
            { t: 'h', text: 'Con un token, para otros clientes' },
            {
                t: 'p',
                md: 'Algunos programas no tienen el botón de autorizar y piden una clave. Para ellos toca **Nuevo token**, ponle un nombre que reconozcas («Cursor en mi portátil»), elige el alcance y el vencimiento y toca **Crear token**. El token se muestra **una sola vez**: cópialo con **Copiar token** y sigue **Cómo conectarlo**. Si lo pierdes, revócalo y crea otro.',
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Un token es como tu contraseña',
                md: 'Quien tenga tu token puede hacer, a través del asistente, lo que tu rol permite. No lo pegues en chats, correos ni documentos compartidos. Si crees que alguien lo vio, revócalo y crea otro.',
            },
            {
                t: 'example',
                title: 'Ejemplo: el informe del lunes',
                md: 'Andrés, gerente comercial, conectó Claude con alcance **Sólo lectura**. Cada lunes le pide: «Resúmeme las oportunidades que pasaron a Ganado la semana pasada, con el valor total por vendedor». Claude consulta la lista con los permisos de Andrés y le arma el resumen en segundos.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿El asistente ve los datos de todos?',
                        a: 'Ve exactamente lo que tú ves, con tus permisos de cada lista. Si cambian tu rol, la conexión se ajusta sola.',
                    },
                    {
                        q: '¿Los clientes del portal o los invitados pueden conectar asistentes?',
                        a: 'No. Sólo las personas del equipo de la empresa.',
                    },
                    {
                        q: '¿Puede borrar cosas sin preguntarme?',
                        a: 'No. Todo cambio llega como propuesta y sólo se aplica cuando confirmas.',
                    },
                ],
            },
            { t: 'h', text: 'Cosas que puedes pedirle' },
            {
                t: 'cards',
                items: [
                    {
                        icon: 'Search',
                        title: 'Consultar',
                        md: '«¿Qué clientes de Medellín no compran hace dos meses?» o «Resume los comentarios del ticket de Ferretería El Sol».',
                        tone: 'blue',
                    },
                    {
                        icon: 'BarChart3',
                        title: 'Calcular',
                        md: '«¿Cuánto facturamos en septiembre por vendedor?» con los mismos totales que verías en un tablero.',
                        tone: 'violet',
                    },
                    {
                        icon: 'Wand2',
                        title: 'Proponer cambios',
                        md: '«Crea una vista kanban por estado» o «sube 5 % el precio de las tazas». Llega como propuesta y tú la aplicas.',
                        tone: 'amber',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Una conexión por empresa',
                md: 'Cada conexión vale para una sola empresa. Si trabajas con dos, conecta cada una por separado (al autorizar eliges cuál).',
            },
            {
                t: 'actions',
                items: [{ label: 'Abrir Seguridad', to: '/settings?s=seguridad' }],
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────────
    {
        id: 'cuenta-y-seguridad-tus-datos',
        route: '/settings?s=datos',
        related: ['cuenta-y-seguridad-contrasena', 'cuenta-y-seguridad-2fa'],
        blocks: [
            {
                t: 'p',
                md: 'Tienes derecho a saber qué datos guarda la app sobre ti y a pedir que se borren. En **Ajustes → Tus datos** haces las dos cosas tú mismo, sin pedírselo a nadie: descargar un archivo con todo lo tuyo, o borrar tu cuenta.',
            },
            {
                t: 'anim',
                key: 'cuenta-datos',
                caption: 'Descargas tus datos en un archivo; si borras tu cuenta, lo que escribiste en la empresa queda como «Usuario eliminado».',
            },
            { t: 'h', text: 'Descargar tus datos' },
            {
                t: 'steps',
                items: [
                    'Abre **Ajustes → Tus datos**.',
                    'En **Descargar tus datos** toca el botón de descarga.',
                    'Se descarga un archivo con tu cuenta, las empresas donde participas y lo que escribiste en cada una: comentarios, actividad, menciones, filtros guardados y archivos subidos. No incluye tu contraseña ni tus claves de seguridad.',
                ],
            },
            { t: 'h', text: 'Borrar tu cuenta' },
            {
                t: 'p',
                md: 'Si ya no vas a usar la app, en **Borrar tu cuenta** toca **Borrar mi cuenta**, confirma con tu contraseña y toca **Borrar definitivamente**. Es **irreversible**.',
            },
            {
                t: 'settings',
                title: 'Qué se borra y qué queda',
                rows: [
                    {
                        name: 'Se borra',
                        what: 'Tu correo, tu nombre, tu contraseña, tu verificación en dos pasos, tu firma, tus filtros guardados y tu acceso a todas las empresas.',
                        tip: 'Todas tus sesiones se cierran al instante.',
                    },
                    {
                        name: 'Queda en la empresa',
                        what: 'Lo que escribiste dentro de una empresa: registros, comentarios e historial. Aparece atribuido a «Usuario eliminado».',
                        tip: 'Esos datos son de la empresa, no tuyos: borrarlos le rompería la operación.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'warn',
                title: 'Si eres el único administrador',
                md: 'Si eres el único admin de alguna empresa, la app no te deja borrar la cuenta y te avisa **Primero nombra otro administrador**: si te fueras, nadie podría administrarla. Pídele a alguien del equipo que pase a Admin (en **Ajustes → Miembros**) y vuelve a intentarlo.',
            },
            {
                t: 'example',
                title: 'Ejemplo: una asesora que se va de la empresa',
                md: 'Si Juliana deja de trabajar en Café Aurora, no hace falta que borre su cuenta: basta con que un admin la quite de **Miembros**. Su cuenta queda para otras empresas donde trabaje. Borrar la cuenta tiene sentido si Juliana ya no va a usar la app en ninguna empresa.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Puedo descargar los datos de toda la empresa?',
                        a: 'Este archivo es sólo lo tuyo. Los datos de la empresa se exportan desde cada lista con **Exportar** (Excel o CSV).',
                    },
                    {
                        q: 'Borré mi cuenta por error, ¿se puede recuperar?',
                        a: 'No. Puedes volver a registrarte con el mismo correo, pero será una cuenta nueva y alguien tendrá que invitarte a la empresa de nuevo.',
                    },
                ],
            },
            {
                t: 'settings',
                title: 'Qué trae el archivo de tus datos',
                rows: [
                    {
                        name: 'Tu cuenta',
                        what: 'Nombre, correo, fechas de alta y de verificación.',
                        tip: 'Nunca incluye tu contraseña ni tus códigos de seguridad.',
                    },
                    {
                        name: 'Tus empresas',
                        what: 'En qué empresas participas y con qué rol.',
                        tip: 'Sólo las empresas donde sigues siendo miembro.',
                    },
                    {
                        name: 'Lo que escribiste',
                        what: 'Tus comentarios, tu actividad, las menciones que recibiste, tus filtros guardados y los archivos que subiste.',
                        tip: 'Cada empresa por separado.',
                    },
                ],
            },
            {
                t: 'callout',
                tone: 'info',
                title: 'Tus datos de cliente en un portal',
                md: 'Si eres cliente de una empresa y entras a su portal, tus datos como cliente los administra esa empresa. Para pedir una copia o el retiro de tu autorización, usa **Mis datos personales** en el menú del portal o escríbele a la empresa.',
            },
            {
                t: 'faq',
                items: [
                    {
                        q: '¿Cada cuánto puedo descargar mis datos?',
                        a: 'Cuando quieras: el archivo se arma en el momento con lo que hay hoy.',
                    },
                    {
                        q: '¿Qué pasa con mis sesiones abiertas y mis conexiones con asistentes al borrar la cuenta?',
                        a: 'Se cierran todas al instante, en todos los dispositivos, y las conexiones dejan de funcionar.',
                    },
                    {
                        q: 'Soy admin de una empresa y me quiero ir, ¿qué hago primero?',
                        a: 'Nombra a otra persona como Admin en **Ajustes → Miembros**, avisa al equipo y recién después borra tu cuenta.',
                    },
                ],
            },
            {
                t: 'actions',
                items: [{ label: 'Abrir Tus datos', to: '/settings?s=datos' }],
            },
        ],
    },
];
