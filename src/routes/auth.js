const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { sign, auth } = require('../middleware/auth');
const { publicUser } = require('../utils');

const reply = (res, user, code = 200) => res.status(code).json({ token: sign(user), user: publicUser(user) });

router.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'Name, email and password are required' });
  if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
  if (await User.findOne({ email: email.toLowerCase() })) return res.status(409).json({ message: 'This email is already registered' });
  const user = await User.create({
    name, email, password: await bcrypt.hash(password, 10),
    role: role === 'artist' ? 'artist' : 'user',
  });
  reply(res, user, 201);
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: (email || '').toLowerCase() }).select('+password');
  if (!user || !user.password || !(await bcrypt.compare(password || '', user.password)))
    return res.status(401).json({ message: 'Incorrect email or password' });
  reply(res, user);
});

router.post('/google', async (req, res) => {
  const { credential, role } = req.body;
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  let payload;
  try {
    payload = (await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID })).getPayload();
  } catch {
    return res.status(401).json({ message: 'Google sign-in could not be verified' });
  }
  let user = await User.findOne({ email: payload.email.toLowerCase() });
  if (!user)
    user = await User.create({
      name: payload.name, email: payload.email, avatar: payload.picture || '', googleId: payload.sub,
      role: role === 'artist' ? 'artist' : 'user',
    });
  reply(res, user);
});

router.get('/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

router.patch('/me', auth, async (req, res) => {
  const { name, avatar } = req.body;
  if (name) req.user.name = name;
  if (typeof avatar === 'string') req.user.avatar = avatar;
  await req.user.save();
  res.json({ user: publicUser(req.user) });
});

router.patch('/me/password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });
  const user = await User.findById(req.user._id).select('+password');
  if (user.password && !(await bcrypt.compare(currentPassword || '', user.password)))
    return res.status(400).json({ message: 'Current password is incorrect' });
  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.json({ message: 'Password updated' });
});

module.exports = router;
