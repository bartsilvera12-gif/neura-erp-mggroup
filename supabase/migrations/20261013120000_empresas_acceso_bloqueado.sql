-- Corte del servicio por falta de pago.
--
-- `acceso_bloqueado` apaga el ERP, el punto de venta y el bot de una empresa sin borrar ni
-- mover nada: al volver a false, todo queda como estaba. `acceso_bloqueado_mensaje` permite
-- cambiar el texto que ve el cliente sin tocar código.
--
-- Se aplica en todos los schemas que tengan la tabla `empresas` (catálogo y monocliente).

DO $$
DECLARE sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'empresas'
       AND c.relkind = 'r'
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname !~ '^pg_'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.empresas
         ADD COLUMN IF NOT EXISTS acceso_bloqueado boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS acceso_bloqueado_at timestamptz,
         ADD COLUMN IF NOT EXISTS acceso_bloqueado_motivo text,
         ADD COLUMN IF NOT EXISTS acceso_bloqueado_mensaje text',
      sch
    );
    EXECUTE format(
      'COMMENT ON COLUMN %I.empresas.acceso_bloqueado IS
         ''true corta ERP, punto de venta y bot de WhatsApp. Volver a false reactiva todo.''',
      sch
    );
  END LOOP;
END $$;
