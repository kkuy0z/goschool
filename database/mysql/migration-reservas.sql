-- GoSchool — Reservas de ambientes e recursos
-- Execute uma vez no banco MySQL do ambiente (Railway).
-- Cria o catálogo de recursos e as reservas com integridade referencial.
-- Conflitos de horário são validados transacionalmente pelo backend,
-- bloqueando a linha do recurso durante a verificação.

USE goschool;

CREATE TABLE IF NOT EXISTS recursos_reserva (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(160) NOT NULL,
  descricao TEXT NULL,
  localizacao VARCHAR(180) NULL,
  capacidade INT UNSIGNED NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_por BIGINT UNSIGNED NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recursos_reserva_nome (nome),
  KEY idx_recursos_reserva_ativo (ativo),
  CONSTRAINT fk_recursos_reserva_criado_por
    FOREIGN KEY (criado_por) REFERENCES usuarios(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reservas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recurso_id BIGINT UNSIGNED NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  titulo VARCHAR(180) NOT NULL,
  finalidade TEXT NULL,
  data_inicio DATETIME NOT NULL,
  data_fim DATETIME NOT NULL,
  status ENUM('PENDENTE','CONFIRMADA','REJEITADA','CANCELADA','ERRO') NOT NULL DEFAULT 'PENDENTE',
  observacao_admin TEXT NULL,
  decidido_por BIGINT UNSIGNED NULL,
  decidido_em DATETIME NULL,
  cancelado_por BIGINT UNSIGNED NULL,
  cancelado_em DATETIME NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reservas_recurso_periodo_status (recurso_id, data_inicio, data_fim, status),
  KEY idx_reservas_usuario_data (usuario_id, data_inicio),
  KEY idx_reservas_status_data (status, data_inicio),
  CONSTRAINT fk_reservas_recurso
    FOREIGN KEY (recurso_id) REFERENCES recursos_reserva(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_reservas_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_reservas_decidido_por
    FOREIGN KEY (decidido_por) REFERENCES usuarios(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_reservas_cancelado_por
    FOREIGN KEY (cancelado_por) REFERENCES usuarios(id)
    ON DELETE SET NULL,
  CONSTRAINT chk_reservas_periodo
    CHECK (data_fim > data_inicio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Catálogo fixo de recursos disponíveis para reserva.
INSERT INTO recursos_reserva (nome, descricao, localizacao, ativo)
VALUES ('Retroprojetor','Equipamento para projeção de apresentações.',NULL,1),('Multimídia','Recurso multimídia para atividades pedagógicas.',NULL,1),('Informática','Laboratório e recursos de informática.',NULL,1)
ON DUPLICATE KEY UPDATE ativo=1;
