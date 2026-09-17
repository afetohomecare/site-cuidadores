export async function verificarTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { ok: true, pulou: true };
  }
  if (!token || String(token).length < 10) {
    return { ok: false };
  }
  try {
    const body = new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: String(token),
      remoteip: ip || ''
    });
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    const data = await resp.json();
    return { ok: !!data.success };
  } catch (err) {
    console.error('Erro Turnstile:', err);
    return { ok: false };
  }
}

export function ipDoPedido(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    ''
  );
}

export async function hashIp(ip) {
  const bruto = String(ip || 'desconhecido');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bruto));
  return Array.from(new Uint8Array(buf)).map(function (b) {
    return b.toString(16).padStart(2, '0');
  }).join('');
}
