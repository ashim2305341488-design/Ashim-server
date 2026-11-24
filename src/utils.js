const mongoose = require('mongoose');
exports.validId = (id) => mongoose.isValidObjectId(id);
exports.publicUser = (u) => ({
  id: u._id, name: u.name, email: u.email, role: u.role, avatar: u.avatar, subscriptionTier: u.subscriptionTier,
});
exports.sendMail = (to, subject, body) => console.log(`[dummy email] to=${to} subject="${subject}"\n${body}`);
