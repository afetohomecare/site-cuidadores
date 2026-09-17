import { ehAdmin } from '../../_lib/auth.js';

// ============================================================
// AFETO — API: login do painel admin
// ------------------------------------------------------------
// Só deixa passar se o user tiver role === 'admin'
// (app_metadata ou user_metadata).
// ============================================================

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const body = await request.json();
    const email = (body.email || '').trim();
    const senha = body.senha || '';

    if (!email || !senha) {
      return jsonResp({ error: 'Informe email e senha.' }, 400);
    }

    const url = env.SUPABASE_URL + '/auth/v1/token?grant_type=password';

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
      },
      body: JSON.stringify({ email: email, password: senha })
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.warn('Login falhou para', email, resp.status);
      return jsonResp({ error: 'Email ou senha incorretos.' }, 401);
    }

    // ⭐ VALIDA ROLE
    if (!ehAdmin(data.user)) {
      console.warn('Tentativa de login admin sem role. Email:', email);
      // Mensagem genérica pra não vazar que o email existe
      return jsonResp({ error: 'Email ou senha incorretos.' }, 401);
    }

    return jsonResp({
      ok: true,
      token: data.access_token,
      expira_em: data.expires_in,
      user: {
        id: data.user.id,
        email: data.user.email
      }
    }, 200);

  } catch (err) {
    console.error('Erro login:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}