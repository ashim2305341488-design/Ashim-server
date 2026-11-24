require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connect = require('./db');

const app = express();
app.use(cors({ origin: (process.env.CLIENT_URL || 'http://localhost:3000').split(',') }));
app.set('trust proxy', 1);
app.use(express.json({ limit: '6mb' })); // AI endpoints receive resized images as base64

app.get('/', (req, res) => res.json({ ok: true, name: 'ArtHub API' }));
app.use(async (req, res, next) => {
  try { await connect(); next(); } catch (e) { next(e); }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/artworks', require('./routes/artworks'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/users', require('./routes/users'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/ai', require('./routes/ai'));

app.use((req, res) => res.status(404).json({ message: 'Route not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Something went wrong', ...(err.code === 'AI_UNAVAILABLE' && { code: err.code }) });
});

module.exports = app;
