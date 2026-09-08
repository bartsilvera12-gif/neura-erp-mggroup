-- =============================================================================
-- Indice para buscar un comprobante por su numero de referencia
--
-- Cada comprobante que llega se compara contra los anteriores por su numero de
-- operacion, para no aceptar dos veces el mismo pago. Esa busqueda no tenia indice:
-- con la tabla chica no se nota, pero crece con cada comprobante recibido y termina
-- sumandole tiempo a cada compra, justo en el paso donde el cliente espera.
--
-- Parcial, como el de la huella del texto: las filas sin referencia no entran, que
-- son las de los comprobantes que el OCR no pudo leer.
-- =============================================================================

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_comprobante_validaciones'
      AND c.relkind = 'r'
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_chat_comp_val_empresa_ref
         ON %I.chat_comprobante_validaciones(empresa_id, ocr_referencia)
         WHERE ocr_referencia IS NOT NULL AND length(trim(ocr_referencia)) > 0',
      sch
    );
    RAISE NOTICE 'indice de referencia creado en %', sch;
  END LOOP;
END $$;
