-- =============================================================================
-- Estados "comprobante_reenviado" y "comprobante_vencido"
--
-- Reenviado: la captura viene de otro chat, o sea que es de otra persona o de una
-- compra anterior. Vencido: la fecha del comprobante es de otro dia, o sea que no
-- corresponde a este pago.
--
-- Incluye tambien el estado de la migracion anterior, asi correr solo esta alcanza.
-- =============================================================================

DO $$
DECLARE
  sch text;
  con record;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_comprobante_validaciones'
      AND c.relkind = 'r'
  LOOP
    FOR con IN
      SELECT c.conname::text
      FROM pg_constraint c
      JOIN pg_class cf ON cf.oid = c.conrelid
      JOIN pg_namespace tn ON tn.oid = cf.relnamespace
      WHERE tn.nspname = sch
        AND cf.relname = 'chat_comprobante_validaciones'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%estado_validacion%'
    LOOP
      EXECUTE format('ALTER TABLE %I.chat_comprobante_validaciones DROP CONSTRAINT IF EXISTS %I', sch, con.conname);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE %I.chat_comprobante_validaciones
       ADD CONSTRAINT chat_comprobante_validaciones_estado_validacion_check
       CHECK (estado_validacion IN (
         ''pendiente'',
         ''valido'',
         ''duplicado_hash'',
         ''duplicado_ocr'',
         ''revision_manual'',
         ''ocr_error'',
         ''monto_incoherente'',
         ''datos_bancarios_incoherentes'',
         ''comprobante_reenviado'',
         ''comprobante_vencido'',
         ''aprobado_manual'',
         ''rechazado_manual''
       ))',
      sch
    );

    RAISE NOTICE 'estados comprobante_reenviado y comprobante_vencido habilitados en %', sch;
  END LOOP;
END $$;
