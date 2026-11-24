const router = require('express').Router();
const Artwork = require('../models/Artwork');
const Comment = require('../models/Comment');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { auth, optionalAuth, role } = require('../middleware/auth');
const { validId } = require('../utils');
const { embedImage } = require('../services/gemini');
const { findDuplicates } = require('../services/vectors');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const POP = { path: 'artist', select: 'name avatar' };

router.get('/categories', (req, res) => res.json(Artwork.CATEGORIES));

router.get('/', async (req, res) => {
  const { search, category, minPrice, maxPrice, sort, artist } = req.query;
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 8, 24);
  const q = {};
  if (category) q.category = category;
  if (artist && validId(artist)) q.artist = artist;
  if (minPrice || maxPrice) q.price = { ...(minPrice && { $gte: +minPrice }), ...(maxPrice && { $lte: +maxPrice }) };
  if (search) {
    const rx = new RegExp(esc(search), 'i');
    const ids = (await User.find({ name: rx, role: 'artist' }).select('_id')).map((u) => u._id);
    q.$or = [{ title: rx }, { tags: rx }, { artist: { $in: ids } }];
  }
  const sorts = { newest: { createdAt: -1 }, 'price-asc': { price: 1 }, 'price-desc': { price: -1 } };
  const [items, total] = await Promise.all([
    Artwork.find(q).sort(sorts[sort] || sorts.newest).skip((page - 1) * limit).limit(limit).populate(POP),
    Artwork.countDocuments(q),
  ]);
  res.json({ items, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
});

router.get('/featured', async (req, res) => {
  res.json(await Artwork.find().sort({ createdAt: -1 }).limit(6).populate(POP));
});

router.get('/mine', auth, role('artist'), async (req, res) => {
  res.json(await Artwork.find({ artist: req.user._id }).sort({ createdAt: -1 }).populate(POP));
});

router.get('/bought', auth, async (req, res) => {
  const tx = await Transaction.find({ user: req.user._id, type: 'purchase' }).select('artwork');
  res.json(await Artwork.find({ _id: { $in: tx.map((t) => t.artwork) } }).populate(POP));
});

router.get('/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Artwork not found' });
  const art = await Artwork.findById(req.params.id).populate(POP);
  if (!art) return res.status(404).json({ message: 'Artwork not found' });
  res.json(art);
});

// Embeds the image and flags near-duplicates. Never blocks or rejects the upload (AI-06, AI-07).
async function indexArtwork(art) {
  try {
    const vec = await embedImage(art.image);
    art.embedding = vec;
    const dups = await findDuplicates(vec, art._id);
    art.duplicates = dups;
    art.dupStatus = dups.length ? 'pending' : 'none';
    await art.save();
    return true;
  } catch (e) {
    console.warn('[ai] could not index artwork:', e.message);
    return false;
  }
}

const cleanTags = (t) => (Array.isArray(t) ? t : String(t || '').split(',')).map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 8);

router.post('/', auth, role('artist'), async (req, res) => {
  const { title, description, price, category, image, tags } = req.body;
  let art;
  try {
    art = await Artwork.create({ title, description, price: +price, category, image, tags: cleanTags(tags), artist: req.user._id });
  } catch (e) {
    return res.status(400).json({ message: 'Please fill in all fields with valid values' });
  }
  const indexed = await indexArtwork(art);
  res.status(201).json({ ...art.toJSON(), aiIndexed: indexed, flaggedAsDuplicate: art.dupStatus === 'pending' });
});

async function ownedOrAdmin(req, res) {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Artwork not found' }), null;
  const art = await Artwork.findById(req.params.id);
  if (!art) return res.status(404).json({ message: 'Artwork not found' }), null;
  const owner = String(art.artist) === String(req.user._id);
  if (!owner && req.user.role !== 'admin') return res.status(403).json({ message: 'Not your artwork' }), null;
  return art;
}

router.put('/:id', auth, async (req, res) => {
  const art = await ownedOrAdmin(req, res);
  if (!art) return;
  if (String(art.artist) !== String(req.user._id)) return res.status(403).json({ message: 'Only the artist can edit' });
  const imageChanged = req.body.image !== undefined && req.body.image !== art.image;
  ['title', 'description', 'price', 'category', 'image'].forEach((k) => req.body[k] !== undefined && (art[k] = req.body[k]));
  if (req.body.tags !== undefined) art.tags = cleanTags(req.body.tags);
  if (imageChanged) { art.embedding = []; art.duplicates = []; art.duplicateStatus = 'none'; } // re-indexed by the client / admin reindex
  await art.save();
  res.json(art);
});

router.delete('/:id', auth, async (req, res) => {
  const art = await ownedOrAdmin(req, res);
  if (!art) return;
  await art.deleteOne();
  await Comment.deleteMany({ artworkId: art._id });
  res.json({ message: 'Artwork deleted' });
});

// ---- comments ----
const hasPurchased = (userId, artworkId) => Transaction.exists({ user: userId, artwork: artworkId, type: 'purchase' });

router.get('/:id/purchased', auth, async (req, res) => {
  res.json({ purchased: !!(await hasPurchased(req.user._id, req.params.id)) });
});

router.get('/:id/comments', async (req, res) => {
  if (!validId(req.params.id)) return res.json([]);
  res.json(await Comment.find({ artworkId: req.params.id }).sort({ createdAt: -1 }).populate('userId', 'name avatar'));
});

router.post('/:id/comments', auth, async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ message: 'Artwork not found' });
  if (!req.body.comment?.trim()) return res.status(400).json({ message: 'Comment cannot be empty' });
  if (!(await hasPurchased(req.user._id, req.params.id)))
    return res.status(403).json({ message: 'Only buyers of this artwork can comment' });
  const c = await Comment.create({ artworkId: req.params.id, userId: req.user._id, comment: req.body.comment });
  res.status(201).json(await c.populate('userId', 'name avatar'));
});

module.exports = router;
