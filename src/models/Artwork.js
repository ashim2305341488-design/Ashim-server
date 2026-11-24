const { Schema, model } = require('mongoose');
const CATEGORIES = ['Painting', 'Digital', 'Sculpture', 'Photography', 'Illustration', 'Mixed Media'];
const schema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    price: { type: Number, required: true, min: 1 },
    category: { type: String, enum: CATEGORIES, required: true },
    image: { type: String, required: true },
    artist: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sold: { type: Boolean, default: false },
    tags: [{ type: String, lowercase: true, trim: true }],
    embedding: { type: [Number], select: false },
    // F5: set when an upload looks like an existing artwork; only an admin can act on it
    dupStatus: { type: String, enum: ['none', 'pending', 'dismissed'], default: 'none' },
    duplicates: [{ _id: false, artwork: { type: Schema.Types.ObjectId, ref: 'Artwork' }, score: Number }],
    tags: [{ type: String, trim: true, lowercase: true }],
    // --- AI fields (hidden from normal queries) ---
    embedding: { type: [Number], select: false },
    duplicateStatus: { type: String, enum: ['none', 'flagged', 'dismissed'], default: 'none', select: false },
    duplicates: { type: [{ _id: false, artwork: { type: Schema.Types.ObjectId, ref: 'Artwork' }, score: Number }], select: false },
  },
  { timestamps: true }
);
const Artwork = model('Artwork', schema);
Artwork.CATEGORIES = CATEGORIES;
module.exports = Artwork;
