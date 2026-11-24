const app = require('./app');
const port = process.env.PORT || 5000;
if (!process.env.VERCEL) app.listen(port, () => console.log(`ArtHub API on :${port}`));
module.exports = app;
