const express = require('express');
const jwt = require('jsonwebtoken');
const uuid4 = require('uuid4');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// Initialize Firebase Admin SDK
const serviceAccount = require('./etc/secrets/service.json'); // Replace with your service account file path
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// Environment variables for secrets (replace with your actual values or use environment variables)
const APP_ACCESS_KEY = process.env.APP_ACCESS_KEY || '<app_access_key>';
const APP_SECRET = process.env.APP_SECRET || '<app_secret>';

// Middleware to verify Firebase ID token
const authenticateFirebaseToken = async (req, res, next) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!idToken) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    try {
        // Verify the ID token
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken; // Attach user info to the request object
        next(); // Proceed to the next middleware/route handler
    } catch (error) {
        console.error('Error verifying Firebase ID token:', error);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

// Route to generate a management token
app.post('/generate-management-token', authenticateFirebaseToken, (req, res) => {
    const payload = {
        access_key: APP_ACCESS_KEY,
        type: 'management',
        version: 2,
        iat: Math.floor(Date.now() / 1000),
        nbf: Math.floor(Date.now() / 1000)
    };

    jwt.sign(
        payload,
        APP_SECRET,
        {
            algorithm: 'HS256',
            expiresIn: '24h',
            jwtid: uuid4()
        },
        function (err, token) {
            if (err) {
                return res.status(500).json({ error: 'Token generation failed' });
            }
            res.json({ token });
        }
    );
});

// Route to generate an app-specific token (e.g., for joining a room)
app.post('/generate-app-token', authenticateFirebaseToken, (req, res) => {
    const { roomId, userId, role } = req.body;

    if (!roomId || !userId || !role) {
        return res.status(400).json({ error: 'roomId, userId, and role are required' });
    }

    const payload = {
        access_key: APP_ACCESS_KEY,
        room_id: roomId,
        user_id: userId,
        role: role,
        type: 'app',
        version: 2,
        iat: Math.floor(Date.now() / 1000),
        nbf: Math.floor(Date.now() / 1000)
    };

    jwt.sign(
        payload,
        APP_SECRET,
        {
            algorithm: 'HS256',
            expiresIn: '24h',
            jwtid: uuid4()
        },
        function (err, token) {
            if (err) {
                return res.status(500).json({ error: 'Token generation failed' });
            }
            res.json({ token });
        }
    );
});

// Health check route
app.get('/', (req, res) => {
    res.send('Token Generation Server is running!');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});