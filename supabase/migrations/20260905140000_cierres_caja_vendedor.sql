-- =============================================================================
-- Cierre de caja por vendedor
--
-- El cierre bloquea lo rendido para que no se cobre dos veces lo mismo. El bloqueo
-- es POR VENTA (`sorteo_entradas.cierre_id`), no por rango de fechas: así una venta
-- cargada tarde, después de cerrar su período, no queda huérfana ni obliga a
-- reabrir un cierre — simplemente entra en el siguiente.
--
-- Se guarda el detalle agregado del cierre y quién lo hizo, para que un cierre
-- viejo se pueda auditar aunque las ventas cambien de estado después.
-- =============================================================================

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'sorteo_entradas'
      AND c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_'
    ORDER BY 1
  LOOP
    RAISE NOTICE 'Aplicando en el esquema %', sch;

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I.sorteo_cierres_caja (
         id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         empresa_id            uuid NOT NULL,
         revendedor_id         uuid NOT NULL,
         periodo_desde         timestamptz NOT NULL,
         periodo_hasta         timestamptz NOT NULL,
         ventas                integer NOT NULL DEFAULT 0,
         boletas               integer NOT NULL DEFAULT 0,
         monto                 numeric NOT NULL DEFAULT 0,
         monto_efectivo        numeric NOT NULL DEFAULT 0,
         /* Quién cerró: se guarda también el nombre porque el usuario puede
            borrarse o cambiar de nombre y el cierre debe seguir siendo legible. */
         cerrado_por_usuario_id uuid,
         cerrado_por_nombre    text,
         observacion           text,
         created_at            timestamptz NOT NULL DEFAULT now()
       )',
      sch
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_sorteo_cierres_caja_rev
         ON %I.sorteo_cierres_caja (empresa_id, revendedor_id, created_at DESC)',
      sch
    );

    /* Marca de qué cierre se llevó cada venta. NULL = todavía sin rendir. */
    EXECUTE format(
      'ALTER TABLE %I.sorteo_entradas ADD COLUMN IF NOT EXISTS cierre_id uuid',
      sch
    );

    /* Índice parcial: las consultas del cierre buscan justamente las no cerradas. */
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_sorteo_entradas_sin_cierre
         ON %I.sorteo_entradas (revendedor_id, created_at)
        WHERE cierre_id IS NULL AND revendedor_id IS NOT NULL',
      sch
    );
  END LOOP;
END $$;
