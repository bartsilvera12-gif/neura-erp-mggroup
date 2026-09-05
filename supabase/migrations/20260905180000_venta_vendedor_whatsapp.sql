-- =============================================================================
-- Modo venta del vendedor por WhatsApp (#VENTA)
--
-- El vendedor escribe al numero corporativo, se identifica con su numero de
-- vendedor y su PIN, y carga la venta paso a paso. Mientras dura ese modo, sus
-- mensajes NO entran al flujo del comprador: por eso hace falta guardar en que
-- paso esta cada conversacion.
--
-- Una fila por conversacion. Se borra al terminar o cancelar, y expira sola: el
-- PIN viaja por el chat, asi que una sesion abierta no debe quedar viva para
-- siempre.
-- =============================================================================

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'sorteo_revendedores'
      AND c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_'
    ORDER BY 1
  LOOP
    RAISE NOTICE 'Aplicando en el esquema %', sch;

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.sorteo_venta_vendedor_sesiones (
         conversation_id uuid PRIMARY KEY,
         empresa_id      uuid NOT NULL,
         /* Null hasta que se valida el PIN: antes solo sabemos a quien dice ser. */
         revendedor_id   uuid,
         paso            text NOT NULL,
         datos           jsonb NOT NULL DEFAULT ''{}''::jsonb,
         intentos_pin    integer NOT NULL DEFAULT 0,
         expira_at       timestamptz NOT NULL,
         created_at      timestamptz NOT NULL DEFAULT now(),
         updated_at      timestamptz NOT NULL DEFAULT now()
       )',
      sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_venta_vendedor_sesiones_expira
         ON %I.sorteo_venta_vendedor_sesiones (expira_at)',
      sch
    );
  END LOOP;
END $$;
