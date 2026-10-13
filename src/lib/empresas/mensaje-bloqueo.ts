/**
 * El texto del corte por falta de pago, sin dependencias de servidor: lo usan la pantalla del
 * ERP y el servidor. La versión que manda es la de la base (`empresas.acceso_bloqueado_mensaje`)
 * cuando está cargada.
 */
export const MENSAJE_BLOQUEO_POR_FALTA_DE_PAGO_UI = [
  "Servicio suspendido por falta de pago.",
  "El acceso al sistema, el punto de venta de los vendedores y el bot de WhatsApp están cortados hasta regularizar el pago.",
  "Tu información está intacta: apenas se acredite el pago, todo se reactiva automáticamente y vas a encontrar todo tal como lo dejaste.",
].join("\n");
