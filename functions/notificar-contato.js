// functions/notificar-contato.js

export async function onRequest(context) {
  // Aceita só POST
  if (context.request.method !== "POST") {
    return new Response("Método não permitido", { status: 405 });
  }

  try {
    const dados = await context.request.json();

    const nome = dados.nome || "Profissional";
    const bairro = dados.bairro || "Curitiba";
    const especialidade = dados.especialidade || "—";
    const ref = dados.ref || "—";
    const origem = dados.origem || "Perfil";

    // Data/hora de Brasília
    const agora = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    const mensagem =
      `💜 *Novo contato na Afeto!*\n\n` +
      `👤 *Cuidadora:* ${nome}\n` +
      `📍 *Bairro:* ${bairro}\n` +
      `🩺 *Especialidade:* ${especialidade}\n` +
      `🔖 *Ref:* #${ref}\n` +
      `📄 *Origem:* ${origem}\n` +
      `🕒 *Quando:* ${agora}`;

    const token = context.env.TELEGRAM_BOT_TOKEN;
    const chatId = context.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      console.error("Telegram não configurado (token ou chat_id ausente)");
      return new Response(JSON.stringify({ ok: false, motivo: "sem_config" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: mensagem,
        parse_mode: "Markdown",
        disable_web_page_preview: true
      })
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Erro notificar-contato:", err);
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}