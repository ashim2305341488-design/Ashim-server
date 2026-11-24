// Similarity search over stored embeddings. Vectors are unit length, so dot product = cosine.
// For a catalogue of a few thousand works this runs in milliseconds. To move to MongoDB Atlas
// Vector Search later, only topK() has to change.
const Artwork = require('../models/Artwork');

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function topK(vec, { exclude, limit = 12, minScore = -1 } = {}) {
  const q = { 'embedding.0': { $exists: true } };
  if (exclude) q._id = { $ne: exclude };
  const all = await Artwork.find(q).select('+embedding').lean();
  const ranked = all
    .map((a) => ({ id: a._id, score: dot(vec, a.embedding) }))
    .filter((r) => r.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
  const docs = await Artwork.find({ _id: { $in: ranked.map((r) => r.id) } }).populate('artist', 'name avatar');
  return ranked.map((r) => ({ artwork: docs.find((d) => String(d._id) === String(r.id)), score: +r.score.toFixed(4) })).filter((r) => r.artwork);
}

// Used after an upload: which existing artworks are suspiciously close? (F5)
async function findDuplicates(vec, exclude) {
  const threshold = parseFloat(process.env.DUP_THRESHOLD) || 0.93;
  return (await topK(vec, { exclude, limit: 3, minScore: threshold })).map((r) => ({ artwork: r.artwork._id, score: r.score }));
}

module.exports = { topK, findDuplicates };
