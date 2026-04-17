// @cm-file domain=auth exports=login,refreshSession routes=POST /login,POST /refresh tests=tests/fixtures/sample-project/tests/auth_login.test.js
const { UserRepo } = require("../db/userRepo");
const { PasswordHasher } = require("../utils/passwordHasher");
const { JwtService } = require("../utils/jwt");

// @cm id=auth.login role=entry involves=UserRepo,PasswordHasher,JwtService affects=auth.routes,session.refresh
async function login(email, password) {
  const user = await UserRepo.findByEmail(email);
  if (!user) return { ok: false, error: "no-user" };
  const ok = await PasswordHasher.verify(password, user.passwordHash);
  if (!ok) return { ok: false, error: "bad-password" };
  const token = JwtService.sign({ sub: user.id });
  return { ok: true, token };
}

// @cm id=session.refresh role=entry involves=JwtService affects=auth.routes
async function refreshSession(oldToken) {
  const claims = JwtService.verify(oldToken);
  if (!claims) return { ok: false };
  return { ok: true, token: JwtService.sign({ sub: claims.sub }) };
}

module.exports = { login, refreshSession };
