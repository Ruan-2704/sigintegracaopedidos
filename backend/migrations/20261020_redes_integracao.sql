-- Aplicar explicitamente antes de ativar o novo backend e o novo gerador.
-- Nao altera gestao.redes nem as views mantidas pela outra aplicacao.
CREATE TABLE IF NOT EXISTS integracaopedidos.redes_integracao (
  codigo_rede INT NOT NULL,
  geracao TINYINT(1) NOT NULL DEFAULT 0,
  validador TINYINT(1) NOT NULL DEFAULT 0,
  versao INT NOT NULL DEFAULT 1,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (codigo_rede)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Preserva as sete redes do gerador e as nove do validador.
-- Reexecucao nao sobrescreve configuracoes feitas no painel.
INSERT INTO integracaopedidos.redes_integracao (codigo_rede, geracao, validador)
SELECT r.CODIGO,
       IF(r.BANCO_DADOS_NOME IN ('redecomprecerto','nossarede','redefarma','redemgfarma','mercaweb','vidafarmacias','grupoadmpharma'), 1, 0),
       1
FROM gestao.redes r
LEFT JOIN integracaopedidos.redes_integracao c ON c.codigo_rede = r.CODIGO
WHERE r.BANCO_DADOS_NOME IN ('redecomprecerto','drogarede','nossarede','farmelhor','redefarma','redemgfarma','mercaweb','vidafarmacias','grupoadmpharma')
  AND c.codigo_rede IS NULL;

SELECT c.*, r.NOME, r.BANCO_DADOS_NOME, r.ATIVO
FROM integracaopedidos.redes_integracao c JOIN gestao.redes r ON r.CODIGO = c.codigo_rede
ORDER BY r.NOME;
