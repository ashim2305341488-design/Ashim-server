// Demo data: 3 artists, 1 buyer, 12 artworks. Run: npm run seed
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');
const Artwork = require('../src/models/Artwork');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const password = await bcrypt.hash('Artist@123', 10);
  const artists = [];
  for (const [name, email] of [['Nadia Rahman', 'nadia@arthub.com'], ['Tanvir Ahmed', 'tanvir@arthub.com'], ['Maya Chowdhury', 'maya@arthub.com']]) {
    artists.push(await User.findOneAndUpdate({ email }, { name, email, password, role: 'artist' }, { upsert: true, new: true }));
  }
  await User.findOneAndUpdate({ email: 'buyer@arthub.com' }, { name: 'Demo Buyer', email: 'buyer@arthub.com', password, role: 'user' }, { upsert: true });
  const titles = ['Monsoon Reverie', 'Neon Delta', 'Quiet Harbor', 'River of Glass', 'Amber Hours', 'Signal Bloom', 'Paper Moon', 'Static Garden', 'Low Tide', 'Cobalt Study', 'Night Market', 'Soft Machine'];
  await Artwork.deleteMany({ artist: { $in: artists.map((a) => a._id) } });
  await Artwork.insertMany(titles.map((title, i) => ({
    title, description: `${title} is an original piece exploring light, texture and memory. Delivered with a certificate of authenticity.`,
    price: 40 + ((i * 37) % 260), category: Artwork.CATEGORIES[i % 6],
    image: `https://picsum.photos/seed/arthub${i}/900/1100`, artist: artists[i % 3]._id,
  })));
  console.log('Seeded.');
  process.exit(0);
})();
