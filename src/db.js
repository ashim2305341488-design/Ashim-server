const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

let cached = global._arthubMongo || (global._arthubMongo = { conn: null, promise: null });

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@arthub.com';
  if (await User.findOne({ email })) return;
  await User.create({
    name: 'ArtHub Admin',
    email,
    password: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@123', 10),
    role: 'admin',
  });
  console.log('Admin account created:', email);
}

module.exports = async function connect() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI).then(async (m) => {
      await seedAdmin();
      return m;
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
};
