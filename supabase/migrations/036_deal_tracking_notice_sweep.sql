-- ============================================================
-- 036_deal_tracking_notice_sweep.sql
--
-- Marca d'água do aviso de rastreio: quando terminou o último ciclo
-- completo (leituras inteiras + varredura de legado sem erro). Se o
-- ciclo ficar parado mais de 24 h (app fora do ar, erro repetido), o
-- próximo ciclo marca como legado todo código sem registro em vez de
-- avisar: salvar o card regrava os valores e renova updated_at, então
-- não dá para distinguir código antigo de código novo.
--
-- Idempotente. Tabela nova de uma linha, só service role.
-- ============================================================

CREATE TABLE IF NOT EXISTS deal_tracking_notice_sweep (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ultimo_ciclo_em TIMESTAMPTZ
);
ALTER TABLE deal_tracking_notice_sweep ENABLE ROW LEVEL SECURITY;

-- A versão anterior já rodava a cada 2 min e todo código existente tem
-- registro: começa no modo normal.
INSERT INTO deal_tracking_notice_sweep (id, ultimo_ciclo_em) VALUES (1, NOW())
ON CONFLICT (id) DO NOTHING;
