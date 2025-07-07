require('dotenv').config();
const express = require('express');
const qrcode = require('qrcode');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const { Canvas, Image } = require('canvas');
const faceapi = require('face-api.js');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Configuration
const config = {
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER
  },
  jwtSecret: process.env.JWT_SECRET,
  mongoURI: process.env.MONGO_URI
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json({ limit: '5mb' }));

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
let otpStore = {};

// MongoDB Connection
mongoose.connect(config.mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// User Schema (Corrected)
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phoneNumber: { type: String, unique: true },
  faceImagePath: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Ticket Schema (With bookingDate)
const ticketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  source: { type: String, required: true },
  destination: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  qrCode: { type: String, required: true },
  aadhaarNumber: { type: String }, // Optional: remove if unused
  status: { type: String, default: 'active', enum: ['active', 'used', 'expired'] },
  bookingDate: { type: Date, required: true },  // ✅ Correct placement
  createdAt: { type: Date, default: Date.now, expires: '24h' }
});



const User = mongoose.model('User', userSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);

// Middleware for token authentication
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(400).json({ success: false, message: 'Invalid token.' });
  }
};

// Initialize FaceAPI.js models
async function loadFaceModels() {
  try {
    const modelsPath = path.join(__dirname, 'models');
    if (!fs.existsSync(modelsPath)) {
      console.error('Face models directory not found at:', modelsPath);
      return;
    }
    
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);
    console.log('FaceAPI models loaded successfully');
  } catch (error) {
    console.error('Error loading face models:', error);
  }
}

// Load models on startup
loadFaceModels();

// Face comparison function
async function compareFaces(liveImageBase64, storedImagePath) {
  try {
    // Load images
    const liveImage = await canvas.loadImage(Buffer.from(liveImageBase64, 'base64'));
    const storedImage = await canvas.loadImage(storedImagePath);

    // Detect faces
    const liveDetection = await faceapi.detectSingleFace(liveImage)
      .withFaceLandmarks()
      .withFaceDescriptor();
      
    const storedDetection = await faceapi.detectSingleFace(storedImage)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!liveDetection || !storedDetection) {
      console.log('Could not detect faces in one or both images');
      return false;
    }

    // Calculate Euclidean distance between face descriptors
    const distance = faceapi.euclideanDistance(
      liveDetection.descriptor,
      storedDetection.descriptor
    );

    // Threshold for face match (adjust as needed)
    return distance < 0.6;
  } catch (error) {
    console.error('Error in face comparison:', error);
    return false;
  }
}

// OTP Routes
app.post("/send-otp", async (req, res) => {
  const { phoneNumber } = req.body;
  
  if (!phoneNumber || !phoneNumber.startsWith('+')) {
    return res.status(400).json({ 
      success: false, 
      message: "Valid phone number with country code is required (e.g., +91XXXXXXXXXX)" 
    });
  }

  const otp = Math.floor(100000 + Math.random() * 900000);

  try {
    await twilioClient.messages.create({
      body: `Your OTP code is: ${otp}`,
      from: config.twilio.phoneNumber,
      to: phoneNumber,
    });

    otpStore[phoneNumber] = otp.toString();
    setTimeout(() => delete otpStore[phoneNumber], 5 * 60 * 1000);
    
    res.json({ 
      success: true, 
      message: "OTP sent successfully!",
      otp: process.env.NODE_ENV === 'development' ? otp : undefined
    });
  } catch (error) {
    console.error("Twilio Error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error sending OTP.",
      error: error.message 
    });
  }
});

app.post("/verify-otp", (req, res) => {
  const { phoneNumber, otp } = req.body;
  
  if (!phoneNumber || !otp) {
    return res.status(400).json({ 
      success: false, 
      message: "Phone number and OTP are required." 
    });
  }

  if (!otpStore[phoneNumber]) {
    return res.status(400).json({ 
      success: false, 
      message: "OTP expired or not requested." 
    });
  }

  if (otpStore[phoneNumber] === otp.toString()) {
    delete otpStore[phoneNumber];
    res.json({ 
      success: true, 
      message: "OTP verified successfully!",
      token: jwt.sign({ phoneNumber }, config.jwtSecret, { expiresIn: '1h' })
    });
  } else {
    res.status(400).json({ 
      success: false, 
      message: "Invalid OTP." 
    });
  }
});

// User Authentication Routes
app.post('/register', async (req, res) => {
  const { name, email, password} = req.body;

  try {
    // Validate input
    if (!name || !email || !password ) {
      return res.status(400).json({ 
        success: false, 
        message: "All fields are required." 
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ email }] });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: "Email or phone number already registered." 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      name,
      email,
      password: hashedPassword,
    
    });

    await user.save();

    // Generate token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      config.jwtSecret,
      { expiresIn: '1h' }
    );

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: "Registration failed. Please try again." 
    });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: "Email and password are required." 
      });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid credentials." 
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid credentials." 
      });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user._id, email: user.email, phoneNumber: user.phoneNumber },
      config.jwtSecret,
      { expiresIn: '1h' }
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: "Login failed. Please try again." 
    });
  }
});

// Face Registration Endpoint
app.post('/register-face', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.user;
    const { image } = req.body; // Base64 encoded image

    if (!image) {
      return res.status(400).json({ 
        success: false, 
        message: "Image is required." 
      });
    }

    // Create uploads directory if it doesn't exist
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Save face image
    const fileName = `face-${userId}-${Date.now()}.jpg`;
    const filePath = path.join(uploadDir, fileName);
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filePath, base64Data, 'base64');

    // Update user with face image path
    await User.findByIdAndUpdate(userId, { faceImagePath: filePath });

    res.json({ 
      success: true, 
      message: "Face registered successfully" 
    });
  } catch (error) {
    console.error('Face registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to register face." 
    });
  }
});

// Ticket creation route - Updated with bookingDate
app.post('/create-ticket', authenticateToken, async (req, res) => {
  const { source, destination, phoneNumber, bookingDate } = req.body;
  const { userId } = req.user;

  // Validate required fields
  if (!source || !destination || !phoneNumber || !bookingDate) {
    return res.status(400).json({ 
      success: false, 
      message: 'All fields are required (source, destination, phoneNumber, bookingDate).' 
    });
  }

  try {
    const ticketData = {
      userId,
      source,
      destination,
      phoneNumber,
      bookingDate: new Date(bookingDate) // Ensure bookingDate is stored as a Date object
    };

    // Generate QR Code
    const qrCode = await qrcode.toDataURL(JSON.stringify(ticketData));

    // Generate unique ticket ID
    const ticketId = 'TKT-' + Date.now().toString(36).toUpperCase();

    // Set expiry time (24 hours from now)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Create new ticket document
    const ticket = new Ticket({
      ticketId,
      ...ticketData,
      qrCode,
      expiresAt
    });

    await ticket.save();

    // Respond with ticket info
    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      ticket: {
        ticketId,
        source,
        destination,
        phoneNumber,
        bookingDate,
        qrCode,
        createdAt: ticket.createdAt,
        expiresAt: ticket.expiresAt
      }
    });
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create ticket.' 
    });
  }
});


// Ticket Verification with Face
app.post('/verify-ticket', authenticateToken, async (req, res) => {
  try {
    const { qrData, faceImage } = req.body;
    const { userId } = req.user;

    // Find ticket
    const ticket = await Ticket.findOne({ qrCode: qrData, userId });
    if (!ticket) {
      return res.status(404).json({ 
        success: false, 
        message: "Ticket not found or doesn't belong to user" 
      });
    }

    // Find user and check if face is registered
    const user = await User.findById(userId);
    if (!user || !user.faceImagePath) {
      return res.status(400).json({ 
        success: false, 
        message: "User face not registered" 
      });
    }

    // Compare faces
    const isMatch = await compareFaces(faceImage, user.faceImagePath);
    if (!isMatch) {
      return res.status(403).json({ 
        success: false, 
        message: "Face verification failed" 
      });
    }

    // Update ticket status
    ticket.status = 'used';
    await ticket.save();

    res.json({ 
      success: true, 
      message: "Ticket verified successfully" 
    });
  } catch (error) {
    console.error('Ticket verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: "Server error during ticket verification" 
    });
  }
});

app.get('/ticket/:id', authenticateToken, async (req, res) => {
  try {
    const ticket = await Ticket.findOne({ ticketId: req.params.id });
    if (!ticket) {
      return res.status(404).json({ 
        success: false, 
        message: 'Ticket not found.' 
      });
    }
    res.json({ 
      success: true, 
      ticket 
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error.' 
    });
  }
});

// Default 404 Route
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Endpoint not found.' 
  });
});

// Start Server
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));