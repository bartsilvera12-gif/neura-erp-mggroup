-- =============================================================================
-- Configuración de impresión del ticket (impresora térmica)
--
-- Es configuración de la EMPRESA, no del sorteo: el ancho del papel, el logo y el
-- nombre del negocio no cambian porque cambie el sorteo. Por eso no se guarda en
-- `sorteos.ticket_image_config`, que es del comprobante que se manda por WhatsApp.
--
-- Una fila por empresa (empresa_id es la PK).
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
      'CREATE TABLE IF NOT EXISTS %I.sorteo_ticket_impresion (
         empresa_id       uuid PRIMARY KEY,
         /* Ancho del rollo en mm. 58 y 80 son los dos formatos de uso corriente. */
         ancho_mm         integer NOT NULL DEFAULT 80,
         negocio_nombre   text,
         logo_url         text,
         encabezado       text,
         pie              text,
         mostrar_telefono boolean NOT NULL DEFAULT true,
         mostrar_vendedor boolean NOT NULL DEFAULT true,
         /* Copias que se imprimen de una: original y duplicado para rendición. */
         copias           integer NOT NULL DEFAULT 1,
         updated_at       timestamptz NOT NULL DEFAULT now()
       )',
      sch
    );

    /*
     * `ADD CONSTRAINT` no admite IF NOT EXISTS: se atrapa el duplicado para que la
     * migración se pueda volver a correr sin fallar.
     */
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.sorteo_ticket_impresion
           ADD CONSTRAINT sorteo_ticket_impresion_ancho_ck
           CHECK (ancho_mm IN (58, 80))',
        sch
      );
    EXCEPTION WHEN duplicate_object THEN
      RAISE NOTICE 'restriccion de ancho ya existente en %', sch;
    END;
  END LOOP;
END $$;
