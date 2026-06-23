# Tradução PT-BR — glossário e regras

Todo o sistema é em **português do Brasil**. Use este glossário para manter consistência.
Traduza **apenas texto visível ao usuário**; nunca código, identificadores ou valores de banco/API.

## Glossário (domínio)

| EN | PT-BR |
|---|---|
| Contact | Contato |
| Deal | Oportunidade |
| Pipeline | Pipeline *(mantém)* |
| Stage | Etapa |
| Broadcast | Transmissão |
| Flow | Fluxo |
| Automation | Automação |
| Template | Template *(mantém)* |
| Conversation | Conversa |
| Message | Mensagem |
| Tag | Tag *(mantém)* |
| Account | Conta |
| Settings | Configurações |
| Dashboard | Painel |
| Recipient | Destinatário |
| Trigger | Gatilho |
| Webhook | Webhook *(mantém)* |
| Lead | Lead *(mantém)* |

## UI comum

Save→Salvar · Cancel→Cancelar · Delete→Excluir · Edit→Editar · Create→Criar · Add→Adicionar ·
New→Novo/Nova · Search→Buscar · Send→Enviar · Update→Atualizar · Loading…→Carregando… ·
Name→Nome · Email→E-mail · Phone→Telefone · Company→Empresa · Status→Status · Created→Criado em ·
Sign in→Entrar · Sign up→Cadastrar · Log out→Sair · Password→Senha · Reset password→Redefinir senha ·
Forgot password→Esqueci a senha · Required→Obrigatório · Optional→Opcional · Confirm→Confirmar ·
Back→Voltar · Next→Avançar · Save changes→Salvar alterações · No X yet→Nenhum X ainda

## Regras (NÃO quebrar)

1. Traduza só: texto JSX visível, labels de botão, `placeholder`/`title`/`aria-label`/`alt`,
   mensagens de `toast.*`, erros/validações mostrados ao usuário, empty states, tooltips, títulos de página/metadata.
2. NUNCA altere: nomes de variáveis/funções/tipos/componentes, imports, chaves de objeto,
   valores de enum/string usados em comparação (`===`) ou enviados a API/DB, classes CSS, rotas/URLs,
   nomes de env vars, `data-testid`, logs técnicos de `console.*`.
3. String que é label E valor de lógica ao mesmo tempo: traduza só a cópia exibida, nunca o valor comparado/salvo.
4. Preserve interpolações: `` `Hello ${name}` `` → `` `Olá ${name}` ``. Mantenha a estrutura de plural.
5. Português natural, com acentuação correta. Não refatore nem reformate código.
