-- Cambios de estructura aplicados por el Agente IA (ticket #709, neura-erp-mggroup). Ya están en la base.

-- Pausa del bot por chat durante 3 horas tras finalizar una compra
ALTER TABLE mggroup.chat_conversations ADD COLUMN IF NOT EXISTS bot_paused_until timestamptz NULL;
