# Cardápio administrativo — configuração

## Banco de dados
Execute no banco `goschool`, nesta ordem, caso ainda não tenha aplicado a primeira migração:

1. `database/mysql/migration-cardapio.sql`
2. `database/mysql/migration-cardapio-admin.sql`

A segunda migração cria as tabelas de ingredientes, restrições, relações ingrediente–restrição, relações refeição–ingrediente, restrições por usuário e histórico de importações.

## Importação Excel assíncrona
O serviço de autenticação precisa das dependências do workspace instaladas e da variável `RABBITMQ_URL` apontando para um broker RabbitMQ acessível pelo serviço e pelo worker.

Inicie o serviço HTTP normalmente e execute o worker em um processo separado:

```bash
npm run worker:cardapio --workspace=auth-service
```

O upload aceita arquivos `.xlsx` de até 5 MB. A primeira aba deve conter as colunas `nome`, `categoria` e `dia_semana`. Colunas opcionais: `descricao`, `horario`, `calorias`, `proteina`, `carboidrato`, `imagem`, `alergicos` e `observacoes`. Valores de `alergicos` podem ser separados por vírgula ou ponto e vírgula.

O serviço valida os campos obrigatórios antes de enfileirar. O worker grava todas as linhas em uma transação: se uma linha falhar, a importação é revertida por completo e o histórico recebe o status de falha.

## Atenção
A rota de importação retorna indisponibilidade se `RABBITMQ_URL` não estiver configurada. Configure o broker e o worker no ambiente de implantação antes de habilitar o envio de planilhas em produção.
