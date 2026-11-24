const router = require('express').Router();
const Stripe = require('stripe');
const Artwork = require('../models/Artwork');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { validId, sendMail } = require('../utils');

const stripe = () => new Stripe(process.env.STRIPE_SECRET_KEY);
const CLIENT = () => (process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0];
const TIERS = { pro: { price: 9.99, limit: 9 }, premium: { price: 19.99, limit: Infinity }, free: { limit: 3 } };
const success = () => `${CLIENT()}/payment/success?session_id={CHECKOUT_SESSION_ID}`;

router.post('/artwork', auth, async (req, res) => {
  const { artworkId } = req.body;
  if (!validId(artworkId)) return res.status(404).json({ message: 'Artwork not found' });
  const art = await Artwork.findById(artworkId).populate('artist', 'name');
  if (!art) return res.status(404).json({ message: 'Artwork not found' });
  if (String(art.artist._id) === String(req.user._id)) return res.status(400).json({ message: 'You cannot buy your own artwork' });
  if (art.sold) return res.status(400).json({ message: 'This artwork has already been sold' });

  const bought = await Transaction.countDocuments({ user: req.user._id, type: 'purchase' });
  const limit = TIERS[req.user.subscriptionTier].limit;
  if (bought >= limit)
    return res.status(403).json({ message: `Your ${req.user.subscriptionTier} plan allows ${limit} purchases. Upgrade to buy more.`, code: 'LIMIT' });

  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: req.user.email,
    line_items: [{
      quantity: 1,
      price_data: { currency: 'usd', unit_amount: Math.round(art.price * 100), product_data: { name: art.title, images: art.image.startsWith('http') ? [art.image] : [] } },
    }],
    metadata: { kind: 'purchase', userId: String(req.user._id), artworkId: String(art._id) },
    success_url: success(),
    cancel_url: `${CLIENT()}/artworks/${art._id}`,
  });
  res.json({ url: session.url });
});

router.post('/subscription', auth, async (req, res) => {
  const tier = req.body.tier;
  if (!['pro', 'premium'].includes(tier)) return res.status(400).json({ message: 'Choose Pro or Premium' });
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: req.user.email,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(TIERS[tier].price * 100), product_data: { name: `ArtHub ${tier[0].toUpperCase() + tier.slice(1)} plan` } } }],
    metadata: { kind: 'subscription', userId: String(req.user._id), tier },
    success_url: success(),
    cancel_url: `${CLIENT()}/dashboard/user`,
  });
  res.json({ url: session.url });
});

// Called by the success page. Verifies the session with Stripe and records it once.
router.post('/confirm', auth, async (req, res) => {
  const { sessionId } = req.body;
  const session = await stripe().checkout.sessions.retrieve(sessionId);
  const m = session.metadata || {};
  if (session.payment_status !== 'paid' || m.userId !== String(req.user._id))
    return res.status(400).json({ message: 'Payment could not be verified' });

  const existing = await Transaction.findOne({ stripeSessionId: session.id });
  if (existing) return res.json({ kind: m.kind, tier: m.tier, already: true });

  const amount = session.amount_total / 100;
  try {
    if (m.kind === 'purchase') {
      const art = await Artwork.findById(m.artworkId);
      await Transaction.create({ type: 'purchase', user: req.user._id, artist: art?.artist, artwork: m.artworkId, amount, stripeSessionId: session.id });
      if (art) { art.sold = true; await art.save(); }
      sendMail(req.user.email, 'Your ArtHub purchase', `Thanks for buying "${art?.title}" for $${amount}.`);
    } else {
      await Transaction.create({ type: 'subscription', user: req.user._id, tier: m.tier, amount, stripeSessionId: session.id });
      await User.findByIdAndUpdate(req.user._id, { subscriptionTier: m.tier });
      sendMail(req.user.email, 'Your ArtHub plan', `You are now on the ${m.tier} plan.`);
    }
  } catch (e) {
    if (e.code !== 11000) throw e; // duplicate confirm (double page load) is fine
  }
  res.json({ kind: m.kind, tier: m.tier, amount });
});

module.exports = router;
