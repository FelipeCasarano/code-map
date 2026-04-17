// @cm-file domain=server exports=createServer routes=GET /health
const { registerAuthRoutes } = require("./auth/routes");

// @cm id=createServer role=entry involves=registerAuthRoutes
function createServer(app) {
  app.get("/health", (_req, res) => res.json({ ok: true }));
  registerAuthRoutes(app);
  return app;
}

module.exports = { createServer };
