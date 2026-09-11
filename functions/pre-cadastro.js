// functions/pre-cadastro.js

export async function onRequest(context) {
  // 1. Recebe os dados do formulário
  const formData = await context.request.formData();
  const nome = formData.get("nome");
  const whatsapp = formData.get("whatsapp");
  const bairro = formData.get("bairro");

  // 2. Validação básica
  if (!nome || !whatsapp || !bairro) {
    return new Response(JSON.stringify({ error: "Todos os campos são obrigatórios." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 3. Monta o objeto com os dados
  const dados = {
    nome: nome,
    whatsapp: whatsapp,
    bairro: bairro,
    data: new Date().toISOString()
  };

  // 4. Gera um ID único para o registro
  const id = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  // 5. Salva no KV (a variável PRE_CADASTROS foi configurada no Cloudflare)
  await context.env.PRE_CADASTROS.put(id, JSON.stringify(dados));

  // 6. Retorna sucesso
  return new Response(JSON.stringify({ success: true, message: "Pré-cadastro realizado!" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}