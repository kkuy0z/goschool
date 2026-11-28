-- Execute uma vez no banco railway para permitir imagens selecionadas do dispositivo.
-- Mantém as imagens existentes e amplia a coluna para armazenar imagens comprimidas.
USE railway;
ALTER TABLE refeicoes MODIFY imagem LONGTEXT NULL;
