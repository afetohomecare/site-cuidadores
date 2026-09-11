// functions/pre-cadastro.js

export async function onRequest(context) {
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
  const valor_plantao = formData.get("valor_plantao") || "";
  const turno = formData.get("turno") || "";
  
  // Campos dos termos (checkboxes)
  const aceite_termos = formData.get("aceite_termos") ? "Sim" : "Não";
  const aceite_lgpd = formData.get("aceite_lgpd") ? "Sim" : "Não";
  const veracidade = formData.get("veracidade") ? "Sim" : "Não";
  const antecedentes = formData.get("antecedentes") ? "Sim" : "Não";

  if (!nome || !whatsapp || !bairros || !profissao) {
    return new Response(JSON.stringify({ error: "Preencha os campos obrigatórios." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const dados = {
    nome, whatsapp, bairros, profissao, coren, cursos, motivacao,
    experiencia, como_conheceu, quem_indicou,
    aceite_termos, aceite_lgpd, veracidade, antecedentes,
    valor_plantao, turno,
    data: new Date().toISOString()
  };

  const id = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  try {
    await context.env.PRE_CADASTROS.put(id, JSON.stringify(dados));
  } catch (err) {
    console.error("Erro KV:", err);
  }

  try {
    await fetch(context.env.GOOGLE_SHEETS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados)
    });
  } catch (err) {
    console.error("Erro Sheets:", err);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}