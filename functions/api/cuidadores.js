export async function onRequestGet(context) {
  const { env } = context;

  const diag = {
    url: env.SUPABASE_URL,
    url_tamanho: env.SUPABASE_URL ? env.SUPABASE_URL.length : 0,
    key_tamanho: env.SUPABASE_SERVICE_KEY ? env.SUPABASE_SERVICE_KEY.length : 0,
    key_comeca_com: env.SUPABASE_SERVICE_KEY ? env.SUPABASE_SERVICE_KEY.substring(0, 30) : null
  };

  const url = env.SUPABASE_URL + '/rest/v1/cuidadores?select=id,nome,aprovada,status_pagamento,plano_profissional,plano_destaque&limit=1';

  let resposta, corpo, erroRede;
  try {
    resposta = await fetch(url, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Accept': 'application/json'
      }
    });
    corpo = await resposta.text();
  } catch (e) {
    erroRede = e.message;
  }

  return new Response(JSON.stringify({
    diag: diag,
    status: resposta ? resposta.status : null,
    corpo: corpo ? corpo.substring(0, 500) : null,
    erro_rede: erroRede
  }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}