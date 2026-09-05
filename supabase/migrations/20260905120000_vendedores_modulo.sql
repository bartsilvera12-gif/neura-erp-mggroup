-- =============================================================================
-- Vendedores como módulo propio de la empresa (ya no cuelgan de un sorteo)
--
-- Antes un vendedor pertenecía a UN sorteo (`sorteo_id NOT NULL`) y su código de
-- referido era único por sorteo. Al terminar el sorteo había que volver a darlo de
-- alta, con otro número y otro link.
--
-- Ahora `sorteo_id` es opcional: NULL = vendedor de la empresa, que vende el sorteo
-- activo. Las filas viejas conservan su sorteo y siguen funcionando igual.
--
-- Se agrega además lo que pide el panel de gestión: número correlativo, cargo y PIN.
--
-- Aplica sobre cualquier esquema que tenga la tabla (una lista cerrada dejaba afuera
-- nombres como «mggroup» y la migración corría sin tocar nada).
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

    /* Vendedor de empresa: sin sorteo asignado. */
    EXECUTE format('ALTER TABLE %I.sorteo_revendedores ALTER COLUMN sorteo_id DROP NOT NULL', sch);

    EXECUTE format(
      'ALTER TABLE %I.sorteo_revendedores
         ADD COLUMN IF NOT EXISTS numero_vendedor integer,
         ADD COLUMN IF NOT EXISTS cargo text,
         ADD COLUMN IF NOT EXISTS pin_hash text,
         ADD COLUMN IF NOT EXISTS pin_actualizado_at timestamptz',
      sch
    );

    /*
     * Correlativo por empresa para los que ya existen, en orden de alta, para que
     * nadie cambie de número al desplegar. Solo toca filas sin número.
     */
    EXECUTE format(
      'UPDATE %I.sorteo_revendedores r
          SET numero_vendedor = calc.n
         FROM (
           SELECT id,
                  row_number() OVER (PARTITION BY empresa_id ORDER BY created_at, id) AS n
             FROM %I.sorteo_revendedores
            WHERE numero_vendedor IS NULL
         ) calc
        WHERE calc.id = r.id
          AND r.numero_vendedor IS NULL',
      sch, sch
    );

    /* El número identifica al vendedor en tickets y cierres: no puede repetirse. */
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_revendedores_empresa_numero
         ON %I.sorteo_revendedores (empresa_id, numero_vendedor)
        WHERE numero_vendedor IS NOT NULL',
      sch
    );

    /*
     * El índice viejo es (sorteo_id, codigo) y con `sorteo_id` NULL no sirve: en
     * Postgres dos NULL no se consideran iguales, así que dejaría pasar códigos
     * repetidos entre vendedores de empresa. Este cubre ese caso.
     */
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_revendedores_empresa_codigo
         ON %I.sorteo_revendedores (empresa_id, lower(trim(codigo_referido)))
        WHERE sorteo_id IS NULL',
      sch
    );
  END LOOP;
END $$;
