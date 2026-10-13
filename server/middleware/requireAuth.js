const { fromNodeHeaders } = require('better-auth/node');
const { auth } = require('../auth');
const { HttpError } = require('../lib/errors');

/**
 * Exige sessão válida e senha definitiva; expõe req.user e req.session para as rotas seguintes.
 * Quem ainda está com senha temporária só acessa /api/auth/* (para trocá-la).
 */
async function requireAuth(req, res, next) {
  try {
    const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!result) throw new HttpError(401, 'UNAUTHORIZED', 'Faça login para continuar.');
    if (result.user.mustChangePassword) {
      throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Troque sua senha temporária para continuar.');
    }
    req.user = result.user;
    req.session = result.session;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
