-- GoSchool: cadastro institucional de usuários.
-- Execute uma vez no MySQL antes de iniciar os serviços.
CREATE DATABASE IF NOT EXISTS goschool
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE goschool;

CREATE TABLE IF NOT EXISTS usuarios (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL,
  tipo ENUM('aluno', 'professor', 'adm') NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  consentimento_responsavel BOOLEAN NULL DEFAULT NULL,
  consentimento_em DATETIME NULL,
  responsavel_nome VARCHAR(160) NULL,
  responsavel_vinculo VARCHAR(100) NULL,
  consentimento_hash CHAR(64) NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email)
);

-- Cadastro é realizado pela instituição/coordenação, nunca pelo formulário público.
-- Não inclua senhas: a autenticação ocorre via Google OAuth institucional.
-- Exemplo de cadastro autorizado (substitua pelos dados reais):
-- INSERT INTO usuarios (nome, email, tipo, ativo)
-- VALUES ('Nome do aluno', 'aluno@aluno.mg.gov.br', 'aluno', TRUE);
