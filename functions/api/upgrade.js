// functions/api/upgrade.js

const AIRTABLE_BASE = 'apphAWeT91l1dMWM5';
const AIRTABLE_TABLE = 'Cuidadores';

export async function onRequest(context) {
  const AIRTABLE_API_KEY = context.env.AIRTABLE_API_KEY;

  if (context.request.method !== "POST") {
    return new Response("Método não permitido", { status: 405 });
  }

  try {
    const formData = await context.request.formData();

    const nome = formData.get("nome") || "";
    const whatsapp = formData.get("whatsapp") || "";
    const bio = formData.get("bio") || "";
    const cursos = formData.get("cursos") || "";
    const subespecialidades = formData.get("subespecialidades") || "";
    const indicadoPor = formData.get("indicadoPor") || "";
    const foto = formData.get("foto");

    if (!nome || !whatsapp) {
      return new Response(JSON.stringify({ error: "Campos obrigatórios ausentes" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Limpa o WhatsApp (só dígitos) para comparar
    const whatsLimpo = whatsapp.replace(/\D/g, '');

    // 1. Baixar TODOS os registros e filtrar em JS
    const listUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?pageSize=100`;
    const listResp = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    const listData = await listResp.json();

    if (!listData.records || listData.records.length === 0) {
      return new Response(JSON.stringify({ ok: false, motivo: "base_vazia" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Busca o registro dela
    const registroDela = listData.records.find(function(r) {
      const wAirtable = (r.fields.WhatsApp || r.fields.WhatsAppAgencia || '').replace(/\D/g, '');
      return wAirtable && wAirtable === whatsLimpo;
    });

    if (!registroDela) {
      await notificarTelegram(context, {
        titulo: "⚠️ Upgrade sem cadastro encontrado",
        nome: nome,
        whatsapp: whatsapp,
        bio: bio,
        subespecialidades: subespecialidades,
        obs: "Não achamos registro com esse WhatsApp. Verificar manualmente."
      });

      return new Response(JSON.stringify({
        ok: false,
        motivo: "cadastro_nao_encontrado"
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const recordId = registroDela.id;

    // 2. Atualizar campos de texto
    const camposAtualizar = {
      Apresentacao: bio,
      Cursos: cursos,
      Subespecialidades: subespecialidades.split(' | ').filter(s => s)
    };
    if (indicadoPor && indicadoPor.trim()) {
      camposAtualizar.IndicadoPor = indicadoPor.trim();
    }

    const updateUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}/${recordId}`;

    await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: camposAtualizar })
    });

    // 3. Upload da foto (passa o token como parâmetro)
    let fotoEnviada = false;
    if (foto && foto.size > 0) {
      try {
        await subirFotoAirtable(AIRTABLE_API_KEY, recordId, foto);
        fotoEnviada = true;
      } catch (err) {
        console.error("Erro ao subir foto:", err);
      }
    }

    // 4. Notificar no Telegram
    await notificarTelegram(context, {
      titulo: "🎉 Novo upgrade de perfil!",
      nome: nome,
      whatsapp: whatsapp,
      bio: bio,
      subespecialidades: subespecialidades,
      indicadoPor: indicadoPor,
      recordId: recordId,
      fotoEnviada: fotoEnviada
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Erro upgrade:", err);
    return new Response(JSON.stringify({
      ok: false,
      error: 'Falha no processamento',
      detalhe: String(err && err.message ? err.message : err)
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// Upload da foto pro Airtable via base64
// ⚡ Recebe o token como parâmetro
async function subirFotoAirtable(apiKey, recordId, file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);

  const uploadUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}/${recordId}/Foto/uploadAttachment`;

  const resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contentType: file.type || 'image/jpeg',
      filename: file.name || 'foto.jpg',
      file: base64
    })
  });

  if (!resp.ok) {
    const erro = await resp.text();
    throw new Error(`Airtable upload falhou: ${resp.status} - ${erro}`);
  }

  return true;
}

async function notificarTelegram(context, dados) {
  try {
    const token = context.env.TELEGRAM_BOT_TOKEN;
    const chatId = context.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    const agora = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });

    let msg = `*${dados.titulo}*\n\n`;
    msg += `👤 *Nome:* ${dados.nome}\n`;
    msg += `📱 *WhatsApp:* ${dados.whatsapp}\n`;
    if (dados.bio) msg += `\n📝 *Bio:* ${dados.bio.substring(0, 180)}${dados.bio.length > 180 ? '...' : ''}\n`;
    if (dados.subespecialidades) msg += `\n🏷️ *Especialidades:* ${dados.subespecialidades}\n`;
    if (dados.indicadoPor) msg += `\n🎁 *Indicada por:* ${dados.indicadoPor}\n`;
    if (dados.fotoEnviada !== undefined) {
      msg += `\n📸 *Foto:* ${dados.fotoEnviada ? '✅ enviada' : '❌ falhou'}\n`;
    }
    if (dados.obs) msg += `\n⚠️ ${dados.obs}\n`;
    msg += `\n🕒 ${agora}`;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: "Markdown",
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    console.error("Telegram:", e);
  }
}