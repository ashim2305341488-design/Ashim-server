const { Schema, model } = require('mongoose');
const schema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, select: false },
    role: { type: String, enum: ['user', 'artist', 'admin'], default: 'user' },
    avatar: { type: String, default: '' },
    googleId: String,
    subscriptionTier: { type: String, enum: ['free', 'pro', 'premium'], default: 'free' },
    wishlist: [{ type: Schema.Types.ObjectId, ref: 'Artwork' }],
  },
  { timestamps: true }
);
module.exports = model('User', schema);
