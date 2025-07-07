# Travelleasy Backend 🚌

This is the backend API for **Travelleasy**, a public transportation ticketing system that simplifies the process of booking, verifying, and managing transport tickets with added face authentication and QR code support.

## 🌐 Live Backend URL

👉 https://travelleasy-backend.onrender.com  
👉 Frontend: https://travelleasy.vercel.app/home

---

## 🚀 Features

- ✅ User Registration and Login (JWT-based)
- ✅ OTP verification via Twilio
- ✅ QR Code generation for tickets
- ✅ Face recognition-based ticket verification (using face-api.js)
- ✅ MongoDB Atlas integration for secure data storage
- ✅ Ticket expiration logic (auto-expires after 24 hours)
- ✅ Fully RESTful API design

---

## 🛠 Tech Stack

- **Node.js**
- **Express.js**
- **MongoDB Atlas with Mongoose**
- **Twilio API** for OTP
- **face-api.js** for face recognition
- **JWT** for authentication
- **Canvas (@napi-rs/canvas)** for image processing
- **QRCode** for ticket encoding
- **Render** for deployment

---

## 📦 API Endpoints

| Endpoint             | Method | Description                      |
|----------------------|--------|----------------------------------|
| `/register`          | POST   | Register new user                |
| `/login`             | POST   | Login and get token              |
| `/send-otp`          | POST   | Send OTP via Twilio              |
| `/verify-otp`        | POST   | Verify OTP and get token         |
| `/register-face`     | POST   | Save face image for a user       |
| `/create-ticket`     | POST   | Generate ticket with QR code     |
| `/verify-ticket`     | POST   | Verify ticket with face match    |
| `/ticket/:id`        | GET    | Get ticket info by ticket ID     |

---



