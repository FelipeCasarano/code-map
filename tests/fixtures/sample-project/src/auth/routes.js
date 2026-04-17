// @cm-file domain=auth/routes exports=registerAuthRoutes routes=POST /login,POST /refresh
const { login, refreshSession } = require("./login");

// @cm id=registerAuthRoutes role=route involves=login,refreshSession affects=server.bootstrap
function registerAuthRoutes(app) {
  app.post("/login", async (req, res) => {
    const r = await login(req.body.email, req.body.password);
    res.json(r);
  });
  app.post("/refresh", async (req, res) => {
    const r = await refreshSession(req.body.token);
    res.json(r);
  });
}

module.exports = { registerAuthRoutes };
