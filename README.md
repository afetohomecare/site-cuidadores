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
- `MP_AMBIENTE` (`producao` ou `sandbox`)
- `MP_ACCESS_TOKEN_PRODUCAO` (token `APP_USR-...` em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app))
- Opcional: `MP_ACCESS_TOKEN_SANDBOX` (token `TEST-...`)
- Opcional: `MP_WEBHOOK_SECRET` (assinatura das notificações)
- Webhook no painel do MP: `https://SEU-DOMINIO/api/mercadopago/webhook` (eventos de **Pagamentos** e **Assinaturas**)

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

O cliente **finaliza no domínio do Mercado Pago** (Checkout Pro). Pix e cartão não são digitados em `afetocuidadores.pages.dev`.

- **Essencial** anual, cobrança **única**: Pix oferta `preco_cadastro` (79,90) com riscado `preco_cadastro_pos` (119,90). Cartão `preco_cadastro_cartao` (119,90) em até 12x — **não** é recorrente.
- **Profissional / Destaque** mensais, sem fidelidade: Pix avulso no Checkout Pro. Cartão tenta **assinatura recorrente** no Mercado Pago; se a assinatura falhar, cobra o primeiro mês avulso. Renovação no Pix também pelo painel.
- Cupom entra no valor **antes** de abrir o Mercado Pago.
- Retorno: `cadastro.html` ou `painel.html` com `?pagamento=cartao_ok` | `cartao_cancelado` | `pix_pendente` | `cartao_expirado`.
- No Supabase, rode `supabase/add-mercadopago.sql` uma vez (colunas `mp_*`). Sem isso o checkout ainda funciona pelo `external_reference`.
- O Asaas fica no código, desligado por `ASAAS_DESATIVADO`. Assinaturas antigas do Asaas continuam recebendo webhook.
- Só Profissional e Destaque entram na vitrine da home.
