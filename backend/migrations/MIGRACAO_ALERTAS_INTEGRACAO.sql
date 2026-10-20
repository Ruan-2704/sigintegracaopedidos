CREATE TABLE IF NOT EXISTS alertas_integracao (
  id INT NOT NULL AUTO_INCREMENT,
  servico VARCHAR(80) NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  severidade VARCHAR(30) DEFAULT 'ALERTA',
  mensagem TEXT,
  detalhe MEDIUMTEXT,
  servidor VARCHAR(120) DEFAULT NULL,
  porta INT DEFAULT NULL,
  enviado_email TINYINT(1) NOT NULL DEFAULT 0,
  email_destino VARCHAR(255) DEFAULT NULL,
  erro_email TEXT DEFAULT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_alertas_integracao_criado_em (criado_em),
  KEY idx_alertas_integracao_servico_tipo (servico, tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
