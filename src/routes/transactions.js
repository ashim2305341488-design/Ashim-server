const router = require('express').Router();
const Transaction = require('../models/Transaction');
const { auth, role } = require('../middleware/auth');

const full = (q) => q.sort({ createdAt: -1 }).populate('user', 'name email').populate('artist', 'name email').populate('artwork', 'title image');

router.get('/mine', auth, async (req, res) => res.json(await full(Transaction.find({ user: req.user._id }))));
router.get('/sales', auth, role('artist'), async (req, res) =>
  res.json(await full(Transaction.find({ artist: req.user._id, type: 'purchase' }))));
router.get('/', auth, role('admin'), async (req, res) => res.json(await full(Transaction.find())));

module.exports = router;
