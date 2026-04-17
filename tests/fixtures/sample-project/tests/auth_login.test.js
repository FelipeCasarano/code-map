// @cm-file domain=tests/auth tests=POST /login
const { login } = require("../src/auth/login");

describe("auth.login", () => {
  it("rejects unknown user", async () => {
    const r = await login("nobody@example.com", "x");
    if (r.ok) throw new Error("expected fail");
  });
  it("accepts valid credentials", async () => {
    const r = await login("alice@example.com", "alice");
    if (!r.ok) throw new Error("expected ok");
  });
});
