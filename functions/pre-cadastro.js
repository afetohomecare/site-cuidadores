export async function onRequest() {
  return new Response(JSON.stringify({ error: 'Esta rota foi desativada.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
