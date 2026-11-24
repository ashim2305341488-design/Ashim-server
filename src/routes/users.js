const router = require('express').Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth, role } = require('../middleware/auth');
const { validId } = require('../utils');

router.get('/top-artists', async (req, res) => {
  const top = await Transaction.aggregate([
    { $match: { type: 'purchase', artist: { $ne: null } } },
    { $group: { _id: '$artist', sales: { $sum: 1 } } },
    { $sort: { sales: -1 } },
    { $limit: 3 },
  ]);
  const found = await User.find({ _id: { $in: top.map((t) => t._id) } }).select('name avatar');
  let list = top.map((t) => ({ ...found.find((u) => String(u._id) === String(t._id))?.toObject(), sales: t.sales })).filter((a) => a._id);
  if (list.length < 3) {
    const extra = await User.find({ role: 'artist', _id: { $nin: list.map((a) => a._id) } })
      .select('name avatar').limit(3 - list.length);
    list = list.concat(extra.map((u) => ({ ...u.toObject(), sales: 0 })));
  }
  res.json(list);
});

router.get('/', auth, role('admin'), async (req, res) => {
  res.json(await User.find().sort({ createdAt: -1 }));
});

router.patch('/:id/role', auth, role('admin'), async (req, res) => {
  if (!validId(req.params.id) || !['user', 'artist', 'admin'].includes(req.body.role))
    return res.status(400).json({ message: 'Invalid request' });
  if (String(req.user._id) === req.params.id) return res.status(400).json({ message: 'You cannot change your own role' });
  const user = await User.findByIdAndUpdate(req.params.id, { role: req.body.role }, { new: true });
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(user);
});

module.exports = router;
