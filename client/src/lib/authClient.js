import { createAuthClient } from 'better-auth/react';
import { adminClient, inferAdditionalFields } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

/** Cliente do Better Auth: mesma origem (/api/auth), sessão em cookie httpOnly. */
export const authClient = createAuthClient({
  baseURL: `${import.meta.env.VITE_API_URL || window.location.origin}/api/auth`,
  plugins: [passkeyClient(), adminClient(), inferAdditionalFields({ user: { mustChangePassword: { type: 'boolean', input: false } } })],
});

const MESSAGES = {
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  USER_ALREADY_EXISTS: 'Já existe uma conta com esse e-mail.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Já existe uma conta com esse e-mail.',
  EMAIL_NOT_VERIFIED: 'Confirme seu e-mail antes de entrar. Reenviamos o link para a sua caixa de entrada.',
  PASSWORD_TOO_SHORT: 'A senha precisa ter pelo menos 10 caracteres.',
  PASSWORD_TOO_LONG: 'Senha longa demais.',
  INVALID_PASSWORD: 'Senha incorreta.',
  INVALID_EMAIL: 'E-mail inválido.',
  INVALID_TOKEN: 'Link inválido ou expirado. Peça um novo.',
  TOKEN_EXPIRED: 'Link expirado. Peça um novo.',
  SESSION_EXPIRED: 'Por segurança, saia e entre novamente para fazer isso.',
  SESSION_NOT_FRESH: 'Por segurança, saia e entre novamente para fazer isso.',
  USER_ALREADY_HAS_PASSWORD: 'Informe sua senha para excluir a conta.',
  EMAIL_PASSWORD_SIGN_UP_DISABLED: 'O cadastro de novas contas está fechado.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'Essa conta não tem senha (entrou com Google/GitHub ou passkey).',
  AUTH_CANCELLED: 'Operação cancelada.',
  REGISTRATION_CANCELLED: 'Cadastro da passkey cancelado.',
  PREVIOUSLY_REGISTERED: 'Essa passkey já está cadastrada.',
  AUTHENTICATION_FAILED: 'Não foi possível entrar com a passkey.',
  BANNED_USER: 'Sua conta foi suspensa. Fale com o administrador.',
  YOU_CANNOT_BAN_YOURSELF: 'Você não pode suspender a própria conta.',
  YOU_CANNOT_REMOVE_YOURSELF: 'Você não pode excluir a própria conta por aqui.',
  PASSKEY_NOT_FOUND: 'Passkey não reconhecida. Entre com e-mail e senha e cadastre-a em “Conta”.',
};

/** Mensagem amigável para um erro do Better Auth ({ code, message, status }). */
export function authErrorMessage(error) {
  if (!error) return '';
  if (error.status === 429) return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
  return MESSAGES[error.code] || error.message || 'Algo deu errado. Tente novamente.';
}
