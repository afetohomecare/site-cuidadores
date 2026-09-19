# Site Cuidadores — Afeto Homecare

Vitrine e cadastro das cuidadoras parceiras. Publicado em [afetocuidadores.pages.dev](https://afetocuidadores.pages.dev).

## Como o projeto está organizado

| Pasta / arquivo | Função |
| --- | --- |
| `index.html`, `cadastro.html`, `planos.html`, `perfil.html` | Páginas públicas |
| `painel.html`, `painel-login.html` | Área da cuidadora |
| `admin/` | Painel interno |
| `functions/api/` | APIs (Cloudflare Pages Functions) |
| `functions/_lib/` | Código compartilhado (auth, HTTP, Supabase, slug) |

O Cloudflare publica a pasta inteira. **Não mova os HTML da raiz** sem atualizar todos os links.

## Publicar

1. Salve no Cursor (`Ctrl+S`).
2. Commit + **push** na branch `main` do GitHub `afetohomecare/site-cuidadores`.
3. O Cloudflare Pages rebuilda sozinho.

## Variáveis no Cloudflare (obrigatórias)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ASAAS_AMBIENTE` (`producao` ou `sandbox`)
- `ASAAS_API_KEY_PRODUCAO` / `ASAAS_API_KEY_SANDBOX`
- `ASAAS_WEBHOOK_TOKEN_PRODUCAO` (ou `ASAAS_WEBHOOK_TOKEN`) — **obrigatório** para o webhook aceitar pagamentos
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- Opcional: `TELEGRAM_WEBHOOK_SECRET` (se configurar no BotFather, o webhook exige esse header)
- Opcional: `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` (cadastro da profissional e solicitar atendimento)

## Solicitações de atendimento

1. No Supabase (SQL Editor), rode `sql/solicitacoes_atendimento.sql` uma vez.
2. No perfil da cuidadora o botão passa a ser **Solicitar atendimento** (WhatsApp só depois do envio).
3. Os pedidos aparecem no painel da profissional e em **Admin → Atendimentos**.

## Vitrine

Só entram profissionais **aprovadas**, com **pagamento em dia**, extra **Profissional ou Destaque** e data de validade futura. O Essencial cria perfil e painel, mas **não** entra na lista da home.

## Link do perfil (slug)

O UUID interno da cuidadora **não muda**. O link público prefere um slug legível (`maria-silva`, `maria-silva-2` se colidir).

1. No Supabase (SQL Editor), rode `supabase/add-slug-cuidadores.sql` uma vez.
2. Cadastros novos geram e gravam o slug. Se a coluna ainda não existir, o cadastro **não quebra** (segue sem slug).
3. O perfil resolve por slug **ou** UUID. Links antigos com UUID continuam funcionando.
4. Palavras reservadas (`api`, `admin`, `painel`, `perfil`, etc.) não viram slug.

## Pagamentos

- **Essencial** é anual: cria perfil + painel. Pix (preço `preco_cadastro`, padrão 79,90) ou cartão (`preco_cadastro_cartao`, padrão 119,90) em até 12x.
- **Cadastro:** Pix no site; cartão só na **página hospedada do Asaas**. Ela escolhe as parcelas **antes** de abrir o link. O cupom já vai no valor.
- **Painel → Meu plano:** mesma lógica para regularizar/renovar o anual.
- Retorno do Asaas: `cadastro.html` ou `painel.html` com `?pagamento=cartao_ok` | `cartao_cancelado` | `cartao_expirado`.
- **Profissional e Destaque** são extras (não criam perfil sozinhos).
- Para criar a chave do cartão no Supabase: `supabase/add-preco-essencial-cartao.sql` (ou salve o preço no admin).
