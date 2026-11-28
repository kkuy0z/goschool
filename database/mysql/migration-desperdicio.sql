-- GoSchool — registros para o dashboard de desperdício.
-- Execute uma vez no MySQL do ambiente (banco goschool).
USE goschool;

CREATE TABLE IF NOT EXISTS desperdicio_registros (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  data_ref DATE NOT NULL,
  refeicao VARCHAR(120) NOT NULL,
  alimentos_preparados_kg DECIMAL(10,3) NOT NULL,
  alimentos_descartados_kg DECIMAL(10,3) NOT NULL,
  criado_por BIGINT UNSIGNED NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_desperdicio_data (data_ref),
  KEY idx_desperdicio_refeicao_data (refeicao, data_ref),
  CONSTRAINT fk_desperdicio_criado_por FOREIGN KEY (criado_por) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT chk_desperdicio_preparado CHECK (alimentos_preparados_kg > 0),
  CONSTRAINT chk_desperdicio_descartado CHECK (alimentos_descartados_kg >= 0 AND alimentos_descartados_kg <= alimentos_preparados_kg)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS desperdicio_configuracoes (
  id TINYINT UNSIGNED NOT NULL,
  limite_taxa_percentual DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  atualizado_por BIGINT UNSIGNED NULL,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_desperdicio_limite CHECK (limite_taxa_percentual >= 0 AND limite_taxa_percentual <= 100),
  CONSTRAINT fk_desperdicio_config_usuario FOREIGN KEY (atualizado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO desperdicio_configuracoes (id, limite_taxa_percentual) VALUES (1, 10.00);
