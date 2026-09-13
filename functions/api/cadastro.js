// functions/api/cadastro.js

const AIRTABLE_BASE = 'apphAWeT91l1dMWM5';
const AIRTABLE_TABLE = 'Cuidadores';

export async function onRequest(context) {
  const AIRTABLE_API_KEY = context.env.AIRTABLE_API_KEY;

  if (context.request.method !== "POST") {
    return new Response("Método não permitido", { status: 405 });
  }

  try {
    const formData = await context.request.formData();

    // ========== CAMPOS DO FORMULÁRIO ==========
    const nome = (formData.get("nome") || "").trim();
    const whatsapp = (formData.get("whatsapp") || "").trim();
    const cpf = (formData.get("cpf") || "").trim();
    const bio = (formData.get("bio") || "").trim();
    const motivacao = (formData.get("motivacao") || "").trim();
    const profissao = (formData.get("profissao") || "").trim();
    const coren = (formData.get("coren") || "").trim();
    const experiencia = (formData.get("experiencia") || "").trim();
    const bairros = (formData.get("bairros") || "").trim();
    const valorPlantao = (formData.get("valor_plantao") || "").trim();
    const turno = (formData.get("turno") || "").trim();
    const subespecialidades = (formData.get("subespecialidades") || "").trim();
    const cursos = (formData.get("cursos") || "").trim();
    const indicadoPor = (formData.get("indicadoPor") || "").trim();
    const plano = (formData.get("plano") || "gratis").toLowerCase();
    const foto = formData.get("foto");

    // ========== VALIDAÇÃO BÁSICA ==========
    if (!nome || !whatsapp || !cpf) {
      return new Response(JSON.stringify({ error: "Campos obrigatórios ausentes." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const cpfLimpo = cpf.replace(/\D/g, '');
    const whatsLimpo = whatsapp.replace(/\D/g, '');

    // ========== DEFINE STATUS CONFORME O PLANO ==========
    let statusPagamento = 'Gratuito';
    let planoProfissional = false;
    let planoDestaque = false;

    if (plano === 'profissional') {
      statusPagamento = 'AguardandoPagamento';
      planoProfissional = true;
    } else if (plano === 'destaque') {
      statusPagamento = 'AguardandoPagamento';
      planoDestaque = true;
    }

    // ========== 1. BUSCAR SE JÁ EXISTE (por CPF, depois WhatsApp) ==========
    const listUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}?pageSize=100`;
    const listResp = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` }
    });
    const listData = await listResp.json();

    let registroExistente = null;

    if (listData.records && listData.records.length > 0) {
      if (cpfLimpo) {
        registroExistente = listData.records.find(function(r) {
          const cpfAirtable = (r.fields.CPF || '').replace(/\D/g, '');
          return cpfAirtable && cpfAirtable === cpfLimpo;
        });
      }
      if (!registroExistente && whatsLimpo) {
        registroExistente = listData.records.find(function(r) {
          const wAirtable = (r.fields.WhatsApp || r.fields.WhatsAppAgencia || '').replace(/\D/g, '');
          return wAirtable && wAirtable === whatsLimpo;
        });
      }
    }

    // ========== 2. MONTA OS CAMPOS A SALVAR ==========
    const campos = {
      Nome: nome,
      WhatsApp: whatsapp,
      CPF: cpf,
      Apresentacao: bio,
      Motivacao: motivacao,
      "Profissão": profissao,
      Experiencia: experiencia,
      Bairros: bairros,
      ValorPlantao: parseFloat(valorPlantao) || 0,
      Turno: turno,
      Cursos: cursos,
      StatusPagamento: statusPagamento,
      Aprovada: false,
      PlanoProfissional: planoProfissional,
      PlanoDestaque: planoDestaque
    };

    if (coren) campos.COREN = coren;

    const subsArray = subespecialidades.split(' | ').filter(function(s) { return s; });
    if (subsArray.length > 0) campos.Subespecialidades = subsArray;

    if (indicadoPor) campos.IndicadoPor = indicadoPor;

    // ========== 3. CRIA OU ATUALIZA O REGISTRO ==========
    let recordId;
    let foiCriado = false;

    if (registroExistente) {
      recordId = registroExistente.id;
      const updateUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}/${recordId}`;

      await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: campos })
      });
    } else {
      const createUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}`;

      const createResp = await fetch(createUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: campos })
      });

      const createData = await createResp.json();
      recordId = createData.id;
      foiCriado = true;
    }

    // ========== 4. UPLOAD DA FOTO ==========
    let fotoEnviada = false;
    if (foto && foto.size > 0 && recordId) {
      try {
        await subirFotoAirtable(AIRTABLE_API_KEY, recordId, foto);
        fotoEnviada = true;
      } catch (err) {
        console.error("Erro ao subir foto:", err);
      }
    }

    // ========== 5. NOTIFICA TELEGRAM ==========
    await notificarTelegram(context, {
      titulo: foiCriado
        ? (plano === 'gratis' ? "💜 Novo cadastro GRÁTIS" : "🎉 Novo cadastro PAGO")
        : (plano === 'gratis' ? "💜 Cadastro GRÁTIS atualizado" : "🎉 Cadastro PAGO atualizado"),
      nome: nome,
      whatsapp: whatsapp,
      cpf: cpf,
      profissao: profissao,
      plano: plano,
      bio: bio,
      subespecialidades: subespecialidades,
      indicadoPor: indicadoPor,
      recordId: recordId,
      fotoEnviada: fotoEnviada
    });

    return new Response(JSON.stringify({
      ok: true,
      recordId: recordId,
      criado: foiCriado
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Erro cadastro:", err);
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

// ========== UPLOAD DA FOTO VIA BASE64 ==========
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

// ========== NOTIFICAÇÃO NO TELEGRAM ==========
async function notificarTelegram(context, dados) {
  try {
    const token = context.env.TELEGRAM_BOT_TOKEN;
    const chatId = context.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      console.log("Telegram não configurado");
      return;
    }

    const agora = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });

    const planoTexto = dados.plano === 'gratis' ? 'Grátis'
                     : dados.plano === 'profissional' ? 'Profissional'
                     : dados.plano === 'destaque' ? 'Destaque' : dados.plano;

    let msg = `*${dados.titulo}*\n\n`;
    msg += `👤 *Nome:* ${dados.nome}\n`;
    msg += `📱 *WhatsApp:* ${dados.whatsapp}\n`;
    if (dados.cpf) msg += `🆔 *CPF:* ${dados.cpf}\n`;
    if (dados.profissao) msg += `💼 *Atuação:* ${dados.profissao}\n`;
    msg += `⭐ *Plano:* ${planoTexto}\n`;
    if (dados.bio) msg += `\n📝 *Bio:* ${dados.bio.substring(0, 180)}${dados.bio.length > 180 ? '...' : ''}\n`;
    if (dados.subespecialidades) msg += `\n🏷️ *Especialidades:* ${dados.subespecialidades}\n`;
    if (dados.indicadoPor) msg += `\n🎁 *Indicada por:* ${dados.indicadoPor}\n`;
    if (dados.fotoEnviada !== undefined) {
      msg += `\n📸 *Foto:* ${dados.fotoEnviada ? '✅ enviada' : '❌ não enviada'}\n`;
    }
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