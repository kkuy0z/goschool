-- GoSchool — expansão do módulo de cardápio
-- Execute uma vez no banco MySQL do ambiente (depois de migration-cardapio.sql).

USE goschool;

CREATE TABLE IF NOT EXISTS ingredientes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(120) NOT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ingredientes_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS restricoes_alimentares (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(120) NOT NULL,
  descricao VARCHAR(500) NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_restricoes_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ingrediente_restricoes (
  ingrediente_id BIGINT UNSIGNED NOT NULL,
  restricao_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (ingrediente_id, restricao_id),
  CONSTRAINT fk_ir_ingrediente FOREIGN KEY (ingrediente_id) REFERENCES ingredientes(id) ON DELETE CASCADE,
  CONSTRAINT fk_ir_restricao FOREIGN KEY (restricao_id) REFERENCES restricoes_alimentares(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refeicao_ingredientes (
  refeicao_id BIGINT UNSIGNED NOT NULL,
  ingrediente_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (refeicao_id, ingrediente_id),
  CONSTRAINT fk_ri_refeicao FOREIGN KEY (refeicao_id) REFERENCES refeicoes(id) ON DELETE CASCADE,
  CONSTRAINT fk_ri_ingrediente FOREIGN KEY (ingrediente_id) REFERENCES ingredientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usuario_restricoes (
  usuario_id BIGINT UNSIGNED NOT NULL,
  restricao_id BIGINT UNSIGNED NOT NULL,
  observacao VARCHAR(500) NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, restricao_id),
  CONSTRAINT fk_ur_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_restricao FOREIGN KEY (restricao_id) REFERENCES restricoes_alimentares(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cardapio_importacoes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  arquivo_nome VARCHAR(255) NOT NULL,
  status ENUM('recebida','validando','processando','concluida','falhou') NOT NULL DEFAULT 'recebida',
  total_linhas INT UNSIGNED NOT NULL DEFAULT 0,
  linhas_importadas INT UNSIGNED NOT NULL DEFAULT 0,
  erros JSON NULL,
  criado_por BIGINT UNSIGNED NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  concluido_em TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_cardapio_importacoes_status (status, criado_em),
  CONSTRAINT fk_ci_criado_por FOREIGN KEY (criado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
