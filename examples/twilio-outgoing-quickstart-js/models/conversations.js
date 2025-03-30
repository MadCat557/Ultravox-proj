const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  transcript: [{ speaker: String, message: String, timestamp: Date }],
  date: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Conversation', conversationSchema);
