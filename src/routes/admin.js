const router = require('express').Router();
const User = require('../models/User');
const Artwork = require('../models/Artwork');
const Transaction = require('../models/Transaction');
const { auth, role } = require('../middleware/auth');

router.get('/stats', auth, role('admin'), async (req, res) => {
  const [totalUsers, totalArtists, totalArtworks, sold, revenue, monthly, byCategory] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'artist' }),
    Artwork.countDocuments(),
    Transaction.countDocuments({ type: 'purchase' }),
    Transaction.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
    Transaction.aggregate([
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, revenue: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Artwork.aggregate([{ $group: { _id: '$category', value: { $sum: 1 } } }]),
  ]);
  res.json({
    totalUsers, totalArtists, totalArtworks, totalSold: sold, totalRevenue: revenue[0]?.total || 0,
    monthly: monthly.map((m) => ({ month: m._id, revenue: m.revenue, sales: m.count })),
    byCategory: byCategory.map((c) => ({ name: c._id, value: c.value })),
  });
});

module.exports = router;
