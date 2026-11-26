# Autenticação GoSchool

## Fluxo
1. O navegador busca `GET /api/auth/config` no Gateway (:3000).
2. Google Identity Services retorna um ID token; o navegador envia-o a `POST /auth/google/callback`.
3. Auth Service valida assinatura/audience do token, exige domínio institucional e consulta o usuário no MySQL.
4. O papel vem somente da tabela `usuarios`; o cliente não pode escolher nem elevar o perfil.
5. A sessão JWT fica em cookie HttpOnly, SameSite=Lax e Secure em produção.

## Preparação local
- Node.js 20+ e MySQL 8+.
- Copie `.env.example` para `.env`, configure Client ID OAuth Web, segredo JWT e credenciais MySQL.
- Execute `database/mysql/schema-auth.sql` no MySQL.
- Cadastre os usuários aprovados na tabela `usuarios` com perfil `aluno`, `professor` ou `adm`.
- Na raiz: `npm install` e `npm run dev`.
- Configure o OAuth Client ID para a origem local e a origem de produção no Google Cloud Console.

## Cadastro
O documento de requisitos prevê autenticação Google institucional e papel definido pela instituição. Portanto, o fluxo não oferece cadastro público nem seleção de papel: a coordenação provisiona/ativa a conta na tabela institucional. O primeiro acesso ocorre pelo botão Google.

## Limites desta etapa
O serviço cobre o fluxo de login, sessão e logout. A autorização de cada rota de negócio deve ser aplicada no backend do respectivo serviço; esconder páginas no frontend não substitui RBAC. O endpoint de cadastro de responsável/consentimento e a rotina de expurgo RF19 devem ser implementados junto ao módulo de consentimento/dados pessoais.
