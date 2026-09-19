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

### Asaas (checkout principal)

- `PAGAMENTO_GATEWAY` = `asaas`
- `ASAAS_DESATIVADO` = `false`
- `ASAAS_AMBIENTE` = `producao` no Production e `sandbox` durante os testes
- `ASAAS_API_KEY_PRODUCAO` e `ASAAS_API_KEY_SANDBOX` — **segredos criptografados no Cloudflare**
- `ASAAS_WEBHOOK_TOKEN_PRODUCAO` e `ASAAS_WEBHOOK_TOKEN_SANDBOX` — **segredos obrigatórios**
- `PAGAMENTO_FALLBACK_ASAAS` = `false`
- Webhook no painel do Asaas: `https://SEU-DOMINIO/api/asaas/webhook`
- O Pix é criado pela API no backend e o QR/copia-e-cola é exibido no site, sem exigir e-mail.
- O cartão e a assinatura abrem o checkout hospedado do Asaas; os dados do cartão não passam pelo site.

### Mercado Pago (legado)

- Mantenha temporariamente as variáveis `MP_*` e o webhook `/api/mercadopago/webhook` enquanto houver pagamentos pendentes ou assinaturas antigas no Mercado Pago.
- Nenhuma venda nova usa Mercado Pago quando `PAGAMENTO_GATEWAY=asaas`.
- Nunca coloque Access Token ou segredo de webhook em HTML, JavaScript público, Git ou `config-publica`.

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

O Asaas é o gateway principal. O Pix é gerado pela API no backend e exibido no site; o cartão é digitado somente no checkout hospedado do Asaas.

- **Essencial** anual, cobrança **única**: Pix transparente no site ou cartão no checkout Asaas.
- **Profissional / Destaque** mensais, sem fidelidade: Pix mensal manual no painel ou assinatura no checkout Asaas.
- Cupom entra no valor **antes** de criar a cobrança.
- O webhook Asaas exige token secreto e confirma o pagamento no backend.
- O Mercado Pago permanece apenas para conciliar pagamentos ou assinaturas antigas.
- Só Profissional e Destaque entram na vitrine da home.

O HTTPS/SSL de `*.pages.dev` é emitido e renovado pelo Cloudflare Pages. Não existe certificado do Banco Central para instalar no site. O QR/copia-e-cola do Pix é emitido pelo Asaas (PSP); o app do banco paga a chave Pix do Asaas, não o domínio da Afeto.
