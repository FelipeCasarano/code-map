// @cm-file domain=utils/jwt exports=JwtService
const SECRET = "test-secret";
const JwtService = {
  sign(claims) {
    return Buffer.from(JSON.stringify({ claims, secret: SECRET })).toString("base64");
  },
  verify(token) {
    try {
      const obj = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
      return obj.secret === SECRET ? obj.claims : null;
    } catch {
      return null;
    }
  },
};
module.exports = { JwtService };
