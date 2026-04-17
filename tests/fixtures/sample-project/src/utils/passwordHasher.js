// @cm-file domain=utils/passwordHasher exports=PasswordHasher
const PasswordHasher = {
  async hash(pw) {
    return "h:" + pw;
  },
  async verify(pw, hash) {
    return ("h:" + pw) === hash;
  },
};
module.exports = { PasswordHasher };
