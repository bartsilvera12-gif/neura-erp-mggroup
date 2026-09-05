-- =============================================================================
-- El modo venta ya no expira solo: se sale con #SALIR
--
-- La sesion caducaba a los 15 minutos de inactividad. En la practica el vendedor
-- carga una venta, atiende a otra persona y vuelve, y encontraba el modo cerrado
-- sin haber hecho nada. Ahora dura hasta que el vendedor escribe #SALIR o
-- termina la venta.
--
-- `expira_at` se deja de escribir; se vuelve opcional en vez de borrar la columna
-- para no romper una version anterior que siguiera desplegada.
-- =============================================================================

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'sorteo_venta_vendedor_sesiones'
      AND c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_'
    ORDER BY 1
  LOOP
    RAISE NOTICE 'Aplicando en el esquema %', sch;
    EXECUTE format(
      'ALTER TABLE %I.sorteo_venta_vendedor_sesiones ALTER COLUMN expira_at DROP NOT NULL',
      sch
    );
  END LOOP;
END $$;
