import { jsonResp } from '../../_lib/http.js';
import { headersSupabase } from '../../_lib/supabase.js';
import { validarAdmin } from '../../_lib/auth.js';
import { urlWhatsAppReset } from '../../_lib/reset-senha.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await validarAdmin(env, request);
  if (!auth.ok) return jsonResp({ error: auth.motivo }, 401);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const agoraIso = new Date().toISOString();
    const resp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores' +
      '?token_reset_senha=not.is.null' +
      '&token_reset_senha_expira_em=gte.' + encodeURIComponent(agoraIso) +
      '&select=id,nome,whatsapp,cpf,token_reset_senha,token_reset_senha_expira_em' +
      '&order=token_reset_senha_expira_em.desc',
      { headers: headersSupabase(env) }
    );

    if (!resp.ok) {
      console.error('Erro listar resets:', await resp.text());
      return jsonResp({ error: 'Falha ao listar pedidos.' }, 502);
    }

    const linhas = await resp.json();
    const pedidos = (linhas || []).map(function (c) {
      return {
        id: c.id,
        nome: c.nome,
        whatsapp: c.whatsapp,
        cpf: c.cpf,
        expira_em: c.token_reset_senha_expira_em,
        waUrl: urlWhatsAppReset(c, c.token_reset_senha)
      };
    }).filter(function (p) { return !!p.waUrl; });

    return jsonResp({ ok: true, pedidos: pedidos }, 200);
  } catch (err) {
    console.error('Erro admin resets:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}
