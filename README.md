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
| `supabase/` | Scripts SQL opcionais (ex.: coluna `slug`) |

O Cloudflare publica a pasta inteira. **Não mova os HTML da raiz** sem atualizar todos os links.

## Link do perfil (slug)

O UUID interno continua no banco. O link público usa um **slug** gerado a partir do nome (ex.: `perfil.html?id=maria-silva`).

Rode uma vez no Supabase (SQL Editor):

```sql
-- ver arquivo supabase/add-slug-cuidadores.sql
ALTER TABLE cuidadores ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS cuidadores_slug_unique ON cuidadores (slug) WHERE slug IS NOT NULL;
```

Sem essa coluna, o site continua funcionando com o UUID no link.

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
- Opcional: `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` (formulário de solicitar atendimento)

## Solicitações de atendimento

1. No Supabase (SQL Editor), rode `sql/solicitacoes_atendimento.sql` uma vez.
2. No perfil da cuidadora o botão passa a ser **Solicitar atendimento** (WhatsApp só depois do envio).
3. Os pedidos aparecem no painel da profissional e em **Admin → Atendimentos**.

## Vitrine

Só entram profissionais **aprovadas**, com **pagamento em dia**, plano **Profissional ou Destaque** e data de validade futura. Cadastro básico não aparece na lista.
