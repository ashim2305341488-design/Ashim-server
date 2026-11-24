const router = require('express').Router();
const Artwork = require('../models/Artwork');
const { auth, role } = require('../middleware/auth');
const { validId } = require('../utils');
const { AIError, embedText, embedImage, analyzeImage, explainPrice } = require('../services/gemini');
const { topK, findDuplicates } = require('../services/vectors');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const POP = { path: 'artist', select: 'name avatar' };
const withScore = (rs) => rs.map((r) => ({ ...r.artwork.toJSON(), score: r.score }));

// AI-07: when AI fails, fall back to plain keyword search
async function keywordFallback(q, limit) {
  const rx = new RegExp(esc(q), 'i');
  return Artwork.find({ $or: [{ title: rx }, { tags: rx }, { description: rx }] }).sort({ createdAt: -1 }).limit(limit).populate(POP);
}

// F1 + F4: one call that drafts the listing and suggests a price range
router.post('/listing-assist', auth, role('artist'), async (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ message: 'Upload an image first' });

  const [meta, vec] = await Promise.allSettled([analyzeImage(imageUrl), embedImage(imageUrl)]);
  if (meta.status === 'rejected' && vec.status === 'rejected')
    return res.status(503).json({ message: `${meta.reason.message}. You can fill in the details manually.`, fallback: true });

  let price = null;
  if (vec.status === 'fulfilled') {
    const near = (await topK(vec.value, { limit: 5 })).filter((r) => r.artwork.price);
    if (near.length) {
      const prices = near.map((r) => r.artwork.price).sort((a, b) => a - b);
      const at = (p) => prices[Math.min(prices.length - 1, Math.floor(p * (prices.length - 1) + 0.5))];
      const low = Math.floor(at(0.25)), high = Math.max(Math.ceil(at(0.75)), Math.floor(at(0.25)) + 1);
      const based = near.map((r) => ({ id: r.artwork._id, title: r.artwork.title, price: r.artwork.price, category: r.artwork.category, image: r.artwork.image, score: r.score }));
      price = { low, high, reason: await explainPrice(meta.value || {}, based, low, high), basedOn: based };
    }
  }
  res.json({
    suggestion: meta.status === 'fulfilled' ? meta.value : null,
    price,
    warnings: [meta.status === 'rejected' && `Listing text unavailable: ${meta.reason.message}`, !price && 'Not enough similar artworks to suggest a price yet.'].filter(Boolean),
  });
});

// F2: natural-language search
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit) || 12, 24);
  if (!q) return res.status(400).json({ message: 'Type what you are looking for' });
  try {
    res.json({ items: withScore(await topK(await embedText(q), { limit })), fallback: false });
  } catch (e) {
    if (!(e instanceof AIError)) throw e;
    res.json({ items: await keywordFallback(q, limit), fallback: true, message: `${e.message}. Showing keyword matches instead.` });
  }
});

// F2: search by image
router.post('/search/image', async (req, res) => {
  if (!req.body.imageUrl) return res.status(400).json({ message: 'Upload an image to search with' });
  try {
    res.json({ items: withScore(await topK(await embedImage(req.body.imageUrl), { limit: 12 })), fallback: false });
  } catch (e) {
    if (!(e instanceof AIError)) throw e;
    res.status(503).json({ message: `${e.message}. Try a text search instead.`, fallback: true });
  }
});

// F3: 6 most similar artworks, never including the artwork itself
router.get('/similar/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.json({ items: [], fallback: true });
  const art = await Artwork.findById(req.params.id).select('+embedding');
  if (!art) return res.status(404).json({ message: 'Artwork not found' });
  try {
    if (!art.embedding?.length) { art.embedding = await embedImage(art.image); await art.save(); }
    res.json({ items: withScore(await topK(art.embedding, { exclude: art._id, limit: 6 })), fallback: false });
  } catch (e) {
    if (!(e instanceof AIError)) throw e;
    const items = await Artwork.find({ _id: { $ne: art._id }, category: art.category }).sort({ createdAt: -1 }).limit(6).populate(POP);
    res.json({ items, fallback: true });
  }
});

// F5: admin review list
router.get('/duplicates', auth, role('admin'), async (req, res) => {
  const list = await Artwork.find({ dupStatus: 'pending' }).sort({ createdAt: -1 })
    .populate(POP).populate({ path: 'duplicates.artwork', select: 'title image price artist', populate: POP });
  res.json(list);
});
router.patch('/duplicates/:id/dismiss', auth, role('admin'), async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Artwork not found' });
  const a = await Artwork.findByIdAndUpdate(req.params.id, { dupStatus: 'dismissed' }, { new: true });
  res.json(a);
});

// Admin: embed artworks that have no vector yet (e.g. seeded data). Call repeatedly until remaining is 0.
router.post('/reindex', auth, role('admin'), async (req, res) => {
  const todo = await Artwork.find({ $or: [{ embedding: { $exists: false } }, { 'embedding.0': { $exists: false } }] }).limit(10);
  let done = 0, failed = 0, lastError = '';
  for (const art of todo) {
    try {
      art.embedding = await embedImage(art.image);
      const dups = await findDuplicates(art.embedding, art._id);
      art.duplicates = dups; art.dupStatus = dups.length ? 'pending' : 'none';
      await art.save(); done++;
    } catch (e) { failed++; lastError = e.message; }
  }
  const remaining = await Artwork.countDocuments({ $or: [{ embedding: { $exists: false } }, { 'embedding.0': { $exists: false } }] });
  res.json({ done, failed, remaining, lastError });
});

module.exports = router;
