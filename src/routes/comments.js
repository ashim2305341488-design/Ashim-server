const router = require('express').Router();
const Comment = require('../models/Comment');
const { auth } = require('../middleware/auth');
const { validId } = require('../utils');

async function mine(req, res) {
  const c = validId(req.params.id) && (await Comment.findById(req.params.id));
  if (!c) return res.status(404).json({ message: 'Comment not found' }), null;
  if (String(c.userId) !== String(req.user._id)) return res.status(403).json({ message: 'You can only change your own comments' }), null;
  return c;
}
router.put('/:id', auth, async (req, res) => {
  const c = await mine(req, res);
  if (!c) return;
  if (!req.body.comment?.trim()) return res.status(400).json({ message: 'Comment cannot be empty' });
  c.comment = req.body.comment;
  await c.save();
  res.json(await c.populate('userId', 'name avatar'));
});
router.delete('/:id', auth, async (req, res) => {
  const c = await mine(req, res);
  if (!c) return;
  await c.deleteOne();
  res.json({ message: 'Comment deleted' });
});
module.exports = router;
