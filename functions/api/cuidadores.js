// functions/api/cuidadores.js
// Proxy de leitura do Airtable — esconde o token no servidor

export async function onRequest(context) {
  const API_KEY = context.env.AIRTABLE_API_KEY;
  const BASE_ID = 'apphAWeT91l1dMWM5';
  const TABLE_NAME = 'Cuidadores';

  if (!API_KEY) {
    return new Response(JSON.stringify({ error: 'Config ausente' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const requestUrl = new URL(context.request.url);
    const id = requestUrl.searchParams.get('id');

    // Se veio ?id=RECxxx → busca só 1 cuidadora
    if (id) {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}/${id}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${API_KEY}` }
      });
      const data = await resp.json();

      return new Response(JSON.stringify(data), {
        status: resp.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60'
        }
      });
    }

    // Sem id → busca todas
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}?pageSize=100`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });
    const data = await resp.json();

    return new Response(JSON.stringify(data), {
      status: resp.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60'
      }
    });

  } catch (err) {
    console.error("Erro proxy cuidadores:", err);
    return new Response(JSON.stringify({ error: 'Falha' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}