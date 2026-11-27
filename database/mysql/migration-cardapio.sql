-- Cardápio GoSchool: refeições cadastradas pela administração.
-- Execute uma vez no banco MySQL do ambiente.
USE goschool;

CREATE TABLE IF NOT EXISTS refeicoes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(180) NOT NULL,
  descricao TEXT NULL,
  categoria ENUM('cafe_manha','almoco','lanche','jantar') NOT NULL,
  dia_semana ENUM('segunda','terca','quarta','quinta','sexta','sabado','domingo') NULL,
  horario TIME NULL,
  calorias INT UNSIGNED NULL,
  proteina DECIMAL(7,2) NULL,
  carboidrato DECIMAL(7,2) NULL,
  imagem VARCHAR(2048) NULL,
  alergicos JSON NOT NULL DEFAULT (JSON_ARRAY()),
  observacoes TEXT NULL,
  criado_por BIGINT UNSIGNED NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_refeicoes_dia_categoria (dia_semana, categoria),
  KEY idx_refeicoes_horario (horario),
  CONSTRAINT fk_refeicoes_criado_por
    FOREIGN KEY (criado_por) REFERENCES usuarios(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
