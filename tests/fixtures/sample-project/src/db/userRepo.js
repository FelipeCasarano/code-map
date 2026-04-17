// @cm-file domain=db/userRepo exports=UserRepo
const users = new Map([
  ["alice@example.com", { id: 1, passwordHash: "h:alice" }],
  ["bob@example.com", { id: 2, passwordHash: "h:bob" }],
]);

const UserRepo = {
  // @cm id=UserRepo.findByEmail role=read involves=users
  async findByEmail(email) {
    return users.get(email) || null;
  },
};

module.exports = { UserRepo };
