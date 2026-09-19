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
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- Opcional: `TELEGRAM_WEBHOOK_SECRET` (se configurar no BotFather, o webhook exige esse header)
- Opcional: `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` (cadastro da profissional e solicitar atendimento)

### Mercado Pago (checkout principal)

- `PAGAMENTO_GATEWAY` = `mercadopago`
- `MP_AMBIENTE` = `producao` no Production e `sandbox` no Preview
- `MP_PUBLIC_KEY_PRODUCAO` e `MP_PUBLIC_KEY_SANDBOX` — identificadores públicos usados pelo Bricks
- `MP_ACCESS_TOKEN_PRODUCAO` (`APP_USR-...`) e `MP_ACCESS_TOKEN_SANDBOX` (`TEST-...`) — **segredos criptografados no Cloudflare**
- `MP_WEBHOOK_SECRET_PRODUCAO` e `MP_WEBHOOK_SECRET_SANDBOX` — **segredos obrigatórios**
- `PAGAMENTO_FALLBACK_ASAAS` = `false`
- `ASAAS_DESATIVADO` = `true`
- Webhook no painel do MP: `https://SEU-DOMINIO/api/mercadopago/webhook` (eventos de **Pagamentos** e **Assinaturas**)
- Nunca coloque Access Token ou segredo do webhook em HTML, JavaScript público, Git ou `config-publica`.
- A Public Key não é secreta e pode ser entregue ao navegador.

### Asaas (código mantido, desativado para vendas novas)

- `ASAAS_DESATIVADO` = `true` — não cria cobrança nova no Asaas
- `PAGAMENTO_FALLBACK_ASAAS` = `true` (padrão) — se o Mercado Pago falhar, tenta o Asaas; use `false` para não cair no Asaas
- `ASAAS_AMBIENTE`, `ASAAS_API_KEY_PRODUCAO`, `ASAAS_WEBHOOK_TOKEN_PRODUCAO` — **mantenha** enquanto houver assinatura antiga no Asaas; o webhook `/api/asaas/webhook` continua ativo

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

O **Checkout Bricks** processa pagamentos avulsos dentro do site. O SDK do Mercado Pago tokeniza o cartão; número, validade e CVV não passam pelas Cloudflare Functions nem são armazenados pela Afeto. O Access Token é usado somente no backend.

- **Essencial** anual, cobrança **única**: Pix e cartão pelo Payment Brick.
- **Profissional / Destaque** mensais, sem fidelidade: Pix mensal manual gerado pela API e exibido pelo Status Screen Brick. Cartão usa assinatura recorrente no ambiente do Mercado Pago.
- Cupom entra no valor **antes** de abrir o Mercado Pago.
- O webhook exige assinatura válida, consulta o pagamento na API e só libera o plano após conferir a ordem e o valor calculado no servidor.
- No Supabase, rode `supabase/add-mercadopago.sql` antes de ativar o checkout. Ele cria as colunas `mp_*` e as tabelas privadas de idempotência.
- O Asaas fica no código, desligado por `ASAAS_DESATIVADO`. Assinaturas antigas do Asaas continuam recebendo webhook.
- Só Profissional e Destaque entram na vitrine da home.

O HTTPS/SSL de `*.pages.dev` é emitido e renovado pelo Cloudflare Pages. Não existe certificado do Banco Central para instalar no site.
