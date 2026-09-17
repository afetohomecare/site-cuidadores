const SITE = 'https://afetocuidadores.pages.dev';

export function linkResetSenha(token) {
  return SITE + '/painel-reset.html?token=' + encodeURIComponent(token);
}

export function numeroWhatsAppCompleto(whatsapp) {
  const limpo = String(whatsapp || '').replace(/\D/g, '');
  if (!limpo) return '';
  if (limpo.length === 10 || limpo.length === 11) return '55' + limpo;
  return limpo;
}

export function mensagemWhatsAppReset(cuidadora, token) {
  const primeiroNome = String(cuidadora && cuidadora.nome || '').trim().split(/\s+/)[0] || '';
  const saudacao = primeiroNome ? 'Oi, ' + primeiroNome + '! 💜' : 'Oi! 💜';
  return saudacao + '\n\n' +
    'Recebi seu pedido de recuperação de senha da Afeto.\n\n' +
    'Clique neste link pra criar uma nova senha (válido por 24 horas):\n\n' +
    linkResetSenha(token) + '\n\n' +
    'Se você não pediu isso, é só ignorar esta mensagem.';
}

export function urlWhatsAppReset(cuidadora, token) {
  const numero = numeroWhatsAppCompleto(cuidadora && cuidadora.whatsapp);
  if (!numero || !token) return null;
  return 'https://wa.me/' + numero + '?text=' + encodeURIComponent(mensagemWhatsAppReset(cuidadora, token));
}
