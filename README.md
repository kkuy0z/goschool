# GoSchool — autenticação institucional

## Modelo de acesso
- O acesso é feito com Google OAuth 2.0, sem senha local.
- São aceitos somente e-mails dos domínios `@aluno.mg.gov.br` e `@educacao.mg.gov.br`.
- O usuário precisa estar previamente cadastrado e ativo em `usuarios`; o perfil não é escolhido na tela de login.
- A conta de aluno não recebe privilégios de escrita por autenticação. A autorização de cada operação deve ser validada no serviço responsável.

## Preparar ambiente local
1. Instale Node.js LTS e MySQL 8.
2. Na raiz do projeto, copie `.env.example` para `.env` e preencha `GOOGLE_CLIENT_ID`, `JWT_SECRET` e as credenciais MySQL. Gere um segredo aleatório forte para `JWT_SECRET`.
3. No Google Cloud Console, configure um OAuth Client ID do tipo Web e inclua `http://localhost:3000` em **Origens JavaScript autorizadas**.
4. Execute `database/schema-auth.sql` no MySQL.
5. Cadastre os usuários autorizados na tabela `goschool.usuarios`. O campo `tipo` aceita somente `aluno`, `professor` ou `adm`.
6. Na raiz, execute `npm install` e depois `npm run dev`.
7. Acesse `http://localhost:3000`.

## Serviços
- Gateway: porta 3000; serve os arquivos de `public` e encaminha as rotas de autenticação.
- Auth Service: porta 4001; valida o token Google, consulta o cadastro institucional e emite sessão JWT em cookie HttpOnly.
- MySQL: fonte de cadastro institucional e papel do usuário.

Em produção, use HTTPS e defina `NODE_ENV=production` para ativar o atributo Secure do cookie. Nunca publique o arquivo `.env` ou credenciais reais.
