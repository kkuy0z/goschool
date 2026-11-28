-- GoSchool — notificações persistentes por usuário
-- Execute uma vez no banco goschool antes de publicar o serviço.

USE goschool;

CREATE TABLE IF NOT EXISTS notificacoes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id BIGINT UNSIGNED NOT NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'sistema',
  titulo VARCHAR(180) NOT NULL,
  mensagem VARCHAR(1000) NOT NULL,
  chave_evento VARCHAR(190) NOT NULL,
  lida_em TIMESTAMP NULL DEFAULT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notificacoes_usuario_evento (usuario_id, chave_evento),
  KEY idx_notificacoes_usuario_criacao (usuario_id, criado_em),
  CONSTRAINT fk_notificacoes_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
