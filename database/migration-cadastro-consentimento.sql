-- Migração para cadastros institucionais e consentimento de responsável.
-- Execute uma única vez em bancos já existentes (não é necessário em banco novo
-- criado pelo schema-auth.sql atualizado).
USE goschool;

ALTER TABLE usuarios
  ADD COLUMN responsavel_nome VARCHAR(160) NULL,
  ADD COLUMN responsavel_vinculo VARCHAR(100) NULL,
  ADD COLUMN consentimento_hash CHAR(64) NULL;
