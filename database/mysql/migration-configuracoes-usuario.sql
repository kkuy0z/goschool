-- Preferências e alergias individuais da página Configurações.
-- Execute uma única vez no banco MySQL do GoSchool.
USE goschool;

CREATE TABLE IF NOT EXISTS configuracoes_usuario (
  usuario_id BIGINT UNSIGNED NOT NULL,
  preferencias JSON NOT NULL,
  alergias JSON NOT NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id),
  CONSTRAINT fk_configuracoes_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;
