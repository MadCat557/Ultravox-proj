import express from 'express';
import mongoose from 'mongoose';
import https from 'https';
import cors from 'cors';
import twilio from 'twilio';
import axios from 'axios';
import fs from 'fs';
import { config } from 'dotenv';

// Load Environment Variables
config();

const app = express();
app.use(express.json());
app.use(cors());

// ✅ Environment Variables
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  ULTRAVOX_API_KEY,
  MONGODB_URI,
  PORT = 3000,
} = process.env;

const ULTRAVOX_API_URL = 'https://api.ultravox.ai/api/calls';

// ✅ MongoDB connection (fixed warnings)
mongoose.connect(MONGODB_URI).then(() => {
  console.log("✅ MongoDB Connected");
}).catch((err) => {
  console.error("❌ MongoDB Connection Error:", err);
});

// ✅ User Schema & Model
const userSchema = new mongoose.Schema({
  phoneNumber: { type: String, unique: true },
  name: String,
  preferences: {
    speechStyle: { type: String, default: "neutral" },
    favoriteTopics: { type: [String], default: [] },
  },
  callHistory: [{
    date: { type: Date, default: Date.now },
    transcript: String,
  }],
}, { timestamps: true });

const User = mongoose.model("User", userSchema);

// ✅ Conversation Schema & Model
const conversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  transcript: [{ speaker: String, message: String, timestamp: Date }],
  date: { type: Date, default: Date.now },
}, { timestamps: true });

const Conversation = mongoose.model('Conversation', conversationSchema);

// ✅ Helper Functions
async function getUser(phoneNumber) {
  let user = await User.findOne({ phoneNumber });
  if (!user) {
    console.log(`New user detected: ${phoneNumber}. Creating profile.`);
    user = new User({ phoneNumber, name: `User-${phoneNumber}` });
    await user.save();
  }
  return user;
}

function generateSystemPrompt(user) {
  return `When the user accepts the call, wait for them to speak. 
You talk slow. You speak slow. You speak like a normal conversation. 
You do not repeat the same style of remarks; keep it fresh with each response. 
Every sentence is brand new. Keep replies down to 1 to 3 sentences.
Speak in a ${user.preferences.speechStyle} manner. 
Try to talk about: ${user.preferences.favoriteTopics.join(", ")}.`;
}

async function createUltravoxCall(user) {
  const ULTRAVOX_CALL_CONFIG = {
    systemPrompt: generateSystemPrompt(user),
    model: 'fixie-ai/ultravox',
    voice: 'Mark',
    temperature: 0.3,
    firstSpeaker: 'FIRST_SPEAKER_USER',
    medium: { "twilio": {} },
  };

  return new Promise((resolve, reject) => {
    const request = https.request(ULTRAVOX_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': ULTRAVOX_API_KEY,
      },
    });

    let data = '';

    request.on('response', (response) => {
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(JSON.parse(data)));
    });

    request.on('error', reject);
    request.write(JSON.stringify(ULTRAVOX_CALL_CONFIG));
    request.end();
  });
}

// ✅ Save Call Recording
async function saveRecording(callSid, phoneNumber) {
  try {
    console.log("📡 Fetching recording...");
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    await new Promise(resolve => setTimeout(resolve, 60000));

    const recordings = await client.recordings.list({ callSid, limit: 1 });

    if (recordings.length === 0) {
      console.log("⚠ No recording found. Retrying in 30 seconds...");
      setTimeout(() => saveRecording(callSid, phoneNumber), 30000);
      return;
    }

    const recording = recordings[0];
    const recordingUrl = `${recording.mediaUrl}.mp3`;

    console.log(`🎙 Downloading recording from: ${recordingUrl}`);

    const response = await axios.get(recordingUrl, {
      responseType: 'arraybuffer',
      auth: {
        username: TWILIO_ACCOUNT_SID,
        password: TWILIO_AUTH_TOKEN,
      },
    });

    if (!fs.existsSync('./recordings')) {
      fs.mkdirSync('./recordings', { recursive: true });
    }

    const filePath = `./recordings/${recording.sid}.mp3`;
    fs.writeFileSync(filePath, response.data);

    console.log(`✅ Recording saved: ${filePath}`);

    const user = await getUser(phoneNumber);
    user.callHistory.push({ transcript: `Recording saved at ${filePath}` });
    await user.save();
  } catch (error) {
    console.error('❌ Error saving recording:', error.message);
  }
}

// ✅ Main function to trigger calls immediately
async function main() {
  try {
    const DESTINATION_PHONE_NUMBER = "+17206035208";  // Replace dynamically if needed

    console.log('📞 Fetching user profile...');
    const user = await getUser(DESTINATION_PHONE_NUMBER);

    console.log('📞 Creating Ultravox call...');
    const { joinUrl } = await createUltravoxCall(user);
    console.log('🎙 Got joinUrl:', joinUrl);

    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    console.log('📡 Initiating Twilio call...');
    const call = await client.calls.create({
      twiml: `<Response><Connect><Stream url="${joinUrl}"/></Connect></Response>`,
      to: DESTINATION_PHONE_NUMBER,
      from: TWILIO_PHONE_NUMBER,
      record: true,
      recordingChannels: "dual",
      recordingStatusCallback: "https://yourserver.com/recording-status",
      recordingStatusCallbackEvent: ["in-progress", "completed"],
    });

    console.log(`✅ Call started: ${call.sid}`);
    setTimeout(() => saveRecording(call.sid, DESTINATION_PHONE_NUMBER), 60000);

  } catch (error) {
    console.error('❌ Main execution failed:', error.message);
  }
}

// ✅ API Routes
app.get('/user/:phoneNumber', async (req, res) => {
  try {
    const user = await getUser(req.params.phoneNumber);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/conversation', async (req, res) => {
  const { phoneNumber, transcript } = req.body;
  if (!phoneNumber || !transcript) {
    return res.status(400).json({ error: "Phone number and transcript required." });
  }

  try {
    const user = await getUser(phoneNumber);
    const conversation = new Conversation({ userId: user._id, transcript });
    await conversation.save();
    res.status(201).json({ message: "Conversation saved.", conversation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ Start Server and Call Main
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  // 👇 Calling main function here after server starts
  main();
});
