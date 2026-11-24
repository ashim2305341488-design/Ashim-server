const { Schema, model } = require('mongoose');
const schema = new Schema(
  {
    type: { type: String, enum: ['purchase', 'subscription'], required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    artist: { type: Schema.Types.ObjectId, ref: 'User' },
    artwork: { type: Schema.Types.ObjectId, ref: 'Artwork' },
    tier: String,
    amount: { type: Number, required: true },
    stripeSessionId: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);
module.exports = model('Transaction', schema);
