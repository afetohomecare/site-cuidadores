// functions/pre-cadastro.js

export async function onRequest(context) {
  // 1. Recebe os dados do formulário
  const formData = await context.request.formData();
  
  const nome = formData.get("nome") || "";
  const whatsapp = formData.get("whatsapp") || "";
  const bairros = formData.get("bairros") || "";
  const profissao = formData.get("profissao") || "";
  const coren = formData.get("coren") || "";
  const cursos = formData.get("cursos") || "";
  const motivacao = formData.get("motivacao") || "";
  const experiencia = formData.get("experiencia") || "";
  const como_conheceu = formData.get("como_conheceu") || "";
  const quem_indicou = formData.get("quem_indicou") || "";

  // 2. Validação básica
  if (!nome || !whatsapp || !bairros || !profissao) {
    return new Response(JSON.stringify({ error: "Preencha os campos obrigatórios." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 3. Monta o objeto com os dados
  const dados = {
    nome,
    whatsapp,
    bairros,
    profissao,
    coren,
    cursos,
    motivacao,
    experiencia,
    como_conheceu,
    quem_indicou,
    data: new Date().toISOString()
  };

  // 4. Gera um ID único
  const id = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  // 5. Salva no KV (backup local)
  try {
    await context.env.PRE_CADASTROS.put(id, JSON.stringify(dados));
  } catch (err) {
    console.error("Erro KV:", err);
  }

  // 6. Envia para o Google Sheets
  try {
    await fetch(context.env.GOOGLE_SHEETS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados)
    });
  } catch (err) {
    console.error("Erro Sheets:", err);
  }

  // 7. Retorna sucesso
  return new Response(JSON.stringify({ success: true, message: "Pré-cadastro realizado!" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}