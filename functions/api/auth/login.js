// ============================================================
// AFETO — API: login da cuidadora
// ------------------------------------------------------------
// Aceita CPF (11 dígitos) OU WhatsApp (10-11 dígitos).
// Converte pra email fake e chama Supabase Auth.
// ============================================================

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const body = await request.json();
    const identificador = (body.identificador || '').trim();
    const senha = body.senha || '';

    if (!identificador || !senha) {
      return jsonResp({ error: 'Informe seu CPF (ou WhatsApp) e a senha.' }, 400);
    }

    const idLimpo = identificador.replace(/\D/g, '');

    if (idLimpo.length < 10 || idLimpo.length > 11) {
      return jsonResp({ error: 'CPF ou WhatsApp inválido.' }, 400);
    }

    // ---------- BUSCA CUIDADORA ----------
    // Busca por CPF limpo, CPF formatado OU WhatsApp limpo
    const filtro = 'or=(' +
      'cpf.eq.' + encodeURIComponent(idLimpo) + ',' +
      'whatsapp.eq.' + encodeURIComponent(idLimpo) + ',' +
      'whatsapp.eq.' + encodeURIComponent(identificador) +
    ')';

    const buscaUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?select=id,cpf,status_pagamento,auth_user_id,nome&' + filtro + '&limit=1';

    const buscaResp = await fetch(buscaUrl, {
      headers: headersSupabase(env)
    });

    if (!buscaResp.ok) {
      return jsonResp({ error: 'Falha ao consultar banco.' }, 502);
    }

    const linhas = await buscaResp.json();

    if (!linhas || linhas.length === 0) {
      return jsonResp({ error: 'CPF/WhatsApp não encontrado. Verifique ou faça seu cadastro.' }, 401);
    }

    const cuidadora = linhas[0];

    if (!cuidadora.auth_user_id) {
      return jsonResp({ error: 'Você ainda não criou sua senha. Finalize o cadastro primeiro.' }, 401);
    }

    // ---------- MONTA EMAIL FAKE ----------
    const cpfLimpo = (cuidadora.cpf || '').replace(/\D/g, '');

    if (cpfLimpo.length !== 11) {
      return jsonResp({ error: 'Cadastro com CPF inválido. Contate o suporte.' }, 500);
    }

    const emailFake = cpfLimpo + '@afeto.app';

    // ---------- CHAMA SUPABASE AUTH ----------
    const authResp = await fetch(env.SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: emailFake,
        password: senha
      })
    });

    const authData = await authResp.json();

    if (!authResp.ok) {
      console.warn('Login falhou:', authResp.status);
      return jsonResp({ error: 'Senha incorreta. Tente novamente.' }, 401);
    }

    return jsonResp({
      ok: true,
      token: authData.access_token,
      expira_em: authData.expires_in,
      user: {
        id: authData.user.id,
        cuidador_id: cuidadora.id,
        nome: cuidadora.nome
      }
    }, 200);

  } catch (err) {
    console.error('Erro login:', err);
    return jsonResp({
      error: 'Falha no processamento.',
      detalhe: String(err && err.message ? err.message : err)
    }, 500);
  }
}

function headersSupabase(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}