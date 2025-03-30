const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  phoneNumber: { type: String, unique: true, required: true },
  name: { type: String, default: 'Anonymous' },
  preferences: {
    speechStyle: { type: String, default: 'neutral' },
    favoriteTopics: { type: [String], default: [] }
  },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
