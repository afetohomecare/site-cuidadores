// ============================================================
// AFETO — API: criar senha da cuidadora (após pagamento)
// ------------------------------------------------------------
// 🛡️ BLINDAGENS:
//   • Valida que o CPF bate com o token de criar senha
//   • Limpa o token após uso (evita reuso)
//   • Devolve mensagens de erro específicas
// ============================================================

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Configuração do servidor ausente.' }, 500);
  }

  try {
    const body = await request.json();
    const cpf = (body.cpf || '').trim();
    const senha = body.senha || '';
    const token = (body.token || '').trim();

    if (!cpf || !senha) {
      return jsonResp({ error: 'CPF e senha são obrigatórios.' }, 400);
    }

    if (!token) {
      return jsonResp({ error: 'Sessão inválida. Volte ao cadastro e tente novamente.' }, 400);
    }

    const cpfLimpo = cpf.replace(/\D/g, '');

    if (cpfLimpo.length !== 11) {
      return jsonResp({ error: 'CPF inválido.' }, 400);
    }

    if (senha.length < 6) {
      return jsonResp({ error: 'A senha precisa ter pelo menos 6 caracteres.' }, 400);
    }

    if (senha.length > 100) {
      return jsonResp({ error: 'Senha muito longa.' }, 400);
    }

    // ---------- BUSCA CUIDADORA POR CPF ----------
    const cpfComFormato = cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    const filtro = 'or=(cpf.eq.' + encodeURIComponent(cpfLimpo) + ',cpf.eq.' + encodeURIComponent(cpfComFormato) + ')';
    const buscaUrl = env.SUPABASE_URL + '/rest/v1/cuidadores?select=id,status_pagamento,auth_user_id,nome,token_criar_senha,token_criar_senha_expira_em&' + filtro + '&limit=1';

    const buscaResp = await fetch(buscaUrl, { headers: headersSupabase(env) });

    if (!buscaResp.ok) {
      console.error('Erro buscar cuidadora:', await buscaResp.text());
      return jsonResp({ error: 'Falha ao consultar banco.' }, 502);
    }

    const linhas = await buscaResp.json();

    if (!linhas || linhas.length === 0) {
      return jsonResp({ error: 'Cadastro não encontrado.' }, 404);
    }

    const cuidadora = linhas[0];

    if (cuidadora.status_pagamento !== 'Pago') {
      return jsonResp({ error: 'É preciso confirmar o pagamento antes de criar a senha.' }, 403);
    }

    if (cuidadora.auth_user_id) {
      return jsonResp({ error: 'Você já tem uma senha criada. Use a tela de login.' }, 409);
    }

    // 🛡️ Valida token
    if (!cuidadora.token_criar_senha) {
      return jsonResp({ error: 'Sessão inválida. Volte ao cadastro e tente novamente.' }, 403);
    }

    // 🛡️ Valida que o token bate
    if (cuidadora.token_criar_senha !== token) {
      console.warn('Token não bate. Recebido:', token.substring(0, 8) + '...', 'Esperado:', cuidadora.token_criar_senha.substring(0, 8) + '...');
      return jsonResp({ error: 'Sessão inválida. Volte ao cadastro e tente novamente.' }, 403);
    }

    // 🛡️ Valida expiração
    if (cuidadora.token_criar_senha_expira_em) {
      const expira = new Date(cuidadora.token_criar_senha_expira_em);
      const agora = new Date();
      if (expira < agora) {
        return jsonResp({ error: 'Sessão expirada. Fale com a gente pelo WhatsApp pra liberar seu acesso.' }, 403);
      }
    }

    // ---------- CRIA USUÁRIO NO SUPABASE AUTH ----------
    const emailFake = cpfLimpo + '@afeto.app';

    const criarUserResp = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users', {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: emailFake,
        password: senha,
        email_confirm: true,
        user_metadata: {
          cuidador_id: cuidadora.id,
          nome: cuidadora.nome,
          role: 'cuidadora'
        }
      })
    });

    const criarUserData = await criarUserResp.json();

    if (!criarUserResp.ok) {
      console.error('Erro criar user Auth:', criarUserResp.status, JSON.stringify(criarUserData));
      return jsonResp({ error: 'Não foi possível criar seu acesso. Tente novamente.' }, 502);
    }

    const authUserId = criarUserData.id;

    // ---------- ATUALIZA CUIDADORA (limpa token) ----------
    const patchResp = await fetch(
      env.SUPABASE_URL + '/rest/v1/cuidadores?id=eq.' + cuidadora.id,
      {
        method: 'PATCH',
        headers: headersSupabase(env, true, false),
        body: JSON.stringify({
          auth_user_id: authUserId,
          senha_criada_em: new Date().toISOString(),
          token_criar_senha: null,
          token_criar_senha_expira_em: null
        })
      }
    );

    if (!patchResp.ok) {
      console.error('Erro vincular auth_user_id:', await patchResp.text());
      // Tenta deletar o user criado pra não deixar órfão
      try {
        await fetch(env.SUPABASE_URL + '/auth/v1/admin/users/' + authUserId, {
          method: 'DELETE',
          headers: {
            'apikey': env.SUPABASE_SERVICE_KEY,
            'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
          }
        });
      } catch (e) {}
      return jsonResp({ error: 'Falha ao vincular acesso. Tente novamente.' }, 502);
    }

    return jsonResp({
      ok: true,
      mensagem: 'Senha criada com sucesso!',
      cuidador_id: cuidadora.id
    }, 200);

  } catch (err) {
    console.error('Erro criar-senha:', err);
    return jsonResp({ error: 'Falha no processamento.' }, 500);
  }
}

function headersSupabase(env, temBody, querRetorno) {
  const h = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Accept': 'application/json'
  };
  if (temBody) h['Content-Type'] = 'application/json';
  if (querRetorno) h['Prefer'] = 'return=representation';
  return h;
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}