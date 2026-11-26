CREATE DATABASE IF NOT EXISTS goschool
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE goschool;

-- A equipe/coordenação provisiona usuários e define o perfil.
-- Não existe cadastro público com escolha de papel.
CREATE TABLE IF NOT EXISTS usuarios (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  tipo ENUM('aluno', 'professor', 'adm') NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email)
);
