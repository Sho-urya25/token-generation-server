// const express = require('express');
// const jwt = require('jsonwebtoken');
// const uuid4 = require('uuid4');
// const admin = require('firebase-admin');
// require('dotenv').config();

// const app = express();
// const PORT = process.env.PORT || 3000;

// // Middleware to parse JSON
// app.use(express.json());

// // Initialize Firebase Admin SDK
// const serviceAccount = require('/etc/secrets/service.json'); // Replace with your service account file path
// admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount)
// });

// // Environment variables for secrets (replace with your actual values or use environment variables)
// const APP_ACCESS_KEY = process.env.APP_ACCESS_KEY || '<app_access_key>';
// const APP_SECRET = process.env.APP_SECRET || '<app_secret>';

// // Middleware to verify Firebase ID token
// const authenticateFirebaseToken = async (req, res, next) => {
//     const idToken = req.headers.authorization?.split('Bearer ')[1];

//     if (!idToken) {
//         return res.status(401).json({ error: 'Unauthorized: No token provided' });
//     }

//     try {
//         // Verify the ID token
//         const decodedToken = await admin.auth().verifyIdToken(idToken);
//         req.user = decodedToken; // Attach user info to the request object
//         next(); // Proceed to the next middleware/route handler
//     } catch (error) {
//         console.error('Error verifying Firebase ID token:', error);
//         return res.status(401).json({ error: 'Unauthorized: Invalid token' });
//     }
// };

// // Route to generate a management token
// app.post('/generate-management-token', authenticateFirebaseToken, (req, res) => {
//     const payload = {
//         access_key: APP_ACCESS_KEY,
//         type: 'management',
//         version: 2,
//         iat: Math.floor(Date.now() / 1000),
//         nbf: Math.floor(Date.now() / 1000)
//     };

//     jwt.sign(
//         payload,
//         APP_SECRET,
//         {
//             algorithm: 'HS256',
//             expiresIn: '24h',
//             jwtid: uuid4()
//         },
//         function (err, token) {
//             if (err) {
//                 return res.status(500).json({ error: 'Token generation failed' });
//             }
//             res.json({ token });
//         }
//     );
// });

// // Route to generate an app-specific token (e.g., for joining a room)
// app.post('/generate-app-token', authenticateFirebaseToken, (req, res) => {
//     const { roomId, userId, role } = req.body;

//     if (!roomId || !userId || !role) {
//         return res.status(400).json({ error: 'roomId, userId, and role are required' });
//     }

//     const payload = {
//         access_key: APP_ACCESS_KEY,
//         room_id: roomId,
//         user_id: userId,
//         role: role,
//         type: 'app',
//         version: 2,
//         iat: Math.floor(Date.now() / 1000),
//         nbf: Math.floor(Date.now() / 1000)
//     };

//     jwt.sign(
//         payload,
//         APP_SECRET,
//         {
//             algorithm: 'HS256',
//             expiresIn: '24h',
//             jwtid: uuid4()
//         },
//         function (err, token) {
//             if (err) {
//                 return res.status(500).json({ error: 'Token generation failed' });
//             }
//             res.json({ token });
//         }
//     );
// });

// // Health check route
// app.get('/', (req, res) => {
//     res.send('Token Generation Server is running!');
// });

// // Start the server
// app.listen(PORT, () => {
//     console.log(`Server is running on port ${PORT}`);
// });


const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios'); // To make HTTP requests to 100ms API
require('dotenv').config();
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// Initialize Firebase Admin SDK
const serviceAccount = require('/etc/secrets/service.json'); // Replace with your service account file path
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore(); // Use Firestore for room management

// Environment variables for secrets (replace with your actual values or use environment variables)
const APP_ACCESS_KEY = process.env.APP_ACCESS_KEY || '<app_access_key>';
const APP_SECRET = process.env.APP_SECRET || '<app_secret>';
const HMS_TEMPLATE_ID = process.env.HMS_TEMPLATE_ID || '<template_id>';

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

// Function to generate a management token
const generateManagementToken = () => {
    const payload = {
        access_key: APP_ACCESS_KEY,
        type: 'management',
        version: 2,
        iat: Math.floor(Date.now() / 1000),
        nbf: Math.floor(Date.now() / 1000)
    };
    return jwt.sign(payload, APP_SECRET, { algorithm: 'HS256', expiresIn: '24h' });
};

// Function to create a new room using 100ms API
const createHMSRoom = async () => {
    const managementToken = generateManagementToken();

    try {
        const response = await axios.post(
            'https://api.100ms.live/v2/rooms',
            {
                name: `room-${Date.now()}`,
                description: 'Random video chat room',
                template_id: HMS_TEMPLATE_ID
            },
            {
                headers: {
                    Authorization: `Bearer ${managementToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data.id; // Return the room ID
    } catch (error) {
        console.error('Error creating 100ms room:', error.response?.data || error.message);
        throw new Error('Failed to create 100ms room');
    }
};

// Route to generate an app-specific token
app.post('/generate-app-token', authenticateFirebaseToken, async (req, res) => {
    const userId = req.user.uid; // Extract user ID from Firebase token
    const roomsRef = db.collection('rooms');

    try {
        // Find an available room with one participant
        const availableRoomSnapshot = await roomsRef
            .where('isFull', '==', false)
            .limit(1)
            .get();

        let roomID;

        if (!availableRoomSnapshot.empty) {
            // Join an existing room
            const roomDoc = availableRoomSnapshot.docs[0];
            roomID = roomDoc.id;

            await roomDoc.ref.update({
                participants: admin.firestore.FieldValue.arrayUnion(userId),
                isFull: true
            });
        } else {
            // Create a new room using 100ms API
            roomID = await createHMSRoom();

            // Store the new room in Firestore
            await roomsRef.doc(roomID).set({
                participants: [userId],
                isFull: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // Generate an app-specific token for the user
        const payload = {
            access_key: APP_ACCESS_KEY,
            room_id: roomID,
            user_id: userId,
            role: 'host', // Default role, change as needed
            type: 'app',
            version: 2,
            iat: Math.floor(Date.now() / 1000),
            nbf: Math.floor(Date.now() / 1000)
        };

        const appToken = jwt.sign(payload, APP_SECRET, { algorithm: 'HS256', expiresIn: '24h' });

        // Return both the app-specific token and room ID
        res.json({ token: appToken, roomID: roomID });
    } catch (error) {
        console.error('Error generating app token:', error);
        res.status(500).json({ error: 'Failed to generate app token' });
    }
});

// Route to leave a room
app.post('/leave-room', authenticateFirebaseToken, async (req, res) => {
    const { roomId, userId } = req.body;

    if (!roomId || !userId) {
        return res.status(400).json({ error: 'roomId and userId are required' });
    }

    try {
        const roomRef = db.collection('rooms').doc(roomId);
        const roomDoc = await roomRef.get();

        if (!roomDoc.exists) {
            return res.status(404).json({ error: 'Room not found' });
        }

        const roomData = roomDoc.data();

        // Remove the user from the room's participants list
        await roomRef.update({
            participants: admin.firestore.FieldValue.arrayRemove(userId)
        });

        // If no participants are left, delete the room
        if (roomData.participants.length === 1) {
            await roomRef.delete();
        }

        res.json({ message: 'User successfully left the room' });
    } catch (error) {
        console.error('Error leaving room:', error);
        res.status(500).json({ error: 'Failed to leave room' });
    }
});

// Health check route
app.get('/', (req, res) => {
    res.send('Token Generation Server is running!');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});