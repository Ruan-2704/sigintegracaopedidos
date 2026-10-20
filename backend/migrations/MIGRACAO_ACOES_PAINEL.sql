CREATE TABLE IF NOT EXISTS painel_acoes (
  id INT NOT NULL AUTO_INCREMENT,
  usuario VARCHAR(80) NOT NULL DEFAULT 'admin',
  acao VARCHAR(80) NOT NULL,
  alvo VARCHAR(120) DEFAULT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'SUCESSO',
  mensagem TEXT,
  detalhe MEDIUMTEXT,
  ip VARCHAR(80) DEFAULT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_painel_acoes_criado_em (criado_em),
  KEY idx_painel_acoes_acao (acao),
  KEY idx_painel_acoes_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
