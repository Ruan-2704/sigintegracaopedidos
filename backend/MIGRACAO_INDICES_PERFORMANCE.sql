-- Índices recomendados para as telas de dashboard, pedidos e logs.
-- Conferir em ambiente controlado antes de rodar em produção.

CREATE INDEX idx_pedidoconfirma_data_pedido
  ON pedidoconfirmaintegracao (dataPedido);

CREATE INDEX idx_pedidoconfirma_campanha
  ON pedidoconfirmaintegracao (IdCampanha);

CREATE INDEX idx_pedidoconfirma_integradora_data
  ON pedidoconfirmaintegracao (integradora, dataPedido);

CREATE INDEX idx_pedidoconfirma_codigo_data
  ON pedidoconfirmaintegracao (codigo, dataPedido);

CREATE INDEX idx_log_integracao_criado_em
  ON log_integracao_pedidos (criado_em);

CREATE INDEX idx_log_integracao_status_criado
  ON log_integracao_pedidos (status, criado_em);

CREATE INDEX idx_log_integracao_campanha
  ON log_integracao_pedidos (id_campanha);
