const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios'); // To make HTTP requests to 100ms API
require('dotenv').config();
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const app = express();
const PORT = process.env.PORT || 3000;
var decodedToken;
// Middleware to parse JSON
app.use(express.json());

// Initialize Firebase Admin SDK
const serviceAccount = require('./service.json'); // Replace with your service account file path
const uuid4 = require('uuid4');
initializeApp({
    credential: cert(serviceAccount),
});
const MAX_PARTICIPANTS  = 2;
const db = getFirestore(); // Use Firestore for room management

// Environment variables for secrets
const APP_SECRET = process.env.APP_SECRET;
const API_KEY = process.env.API_KEY;

if (!APP_SECRET || !API_KEY) {
    console.error("Missing API_KEY or APP_SECRET in environment variables");
    process.exit(1);
}

// Middleware to verify Firebase ID token
const authenticateFirebaseToken = async (req, res, next) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    try {
         decodedToken = await getAuth().verifyIdToken(idToken);
        req.user = decodedToken; // Attach user info to the request object
        next();
    } catch (error) {
        console.error('Error verifying Firebase ID token:', error);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

// Function to generate a management token
const generateRoomToken = () => {
    const options = { expiresIn: '120m', algorithm: 'HS256' };
var roomId = uuid4();
    const payload = {
        apikey: API_KEY,
        permissions: ["allow_join"], 
        version:2,
        roomId:roomId,
        participantId:decodedToken.uid,
        roles: ['crawler']
        // Adjust permissions as needed

    };
    const token = jwt.sign(payload, APP_SECRET, options);
    console.log("Generated Management Token:", token);
    return token;
};

// Function to create a new room using 100ms API
const createRoom = async (token) => {
    try {
        const response = await axios.post(
            'https://api.videosdk.live/v2/rooms',
            {}, // Empty body since we're not providing customRoomId
            {
                headers: {
                    Authorization: token,
                    'Content-Type': 'application/json',
                },
            }
        );
        console.log("Room Creation Response:", response.data);
        return response.data.roomId; // Assuming the API returns roomId in the response
    } catch (error) {
        console.error('Error creating room:', error.response?.data || error.message);
        throw new Error('Failed to create room');
    }
};

// Route to generate an app-specific token and create a room
app.post('/join-randomroom', authenticateFirebaseToken, async (req, res) => {
    const userId = req.user.uid; // Extract user ID from Firebase token
    const roomsRef = db.collection('rooms');
    const MAX_PARTICIPANTS = 4; // Maximum number of participants per room

    try {
        // Step 1: Check if the user is already in any room
        const allRoomsQuery = await roomsRef.get();

        for (const roomDoc of allRoomsQuery.docs) {
            const roomData = roomDoc.data();

            // If the user is already in a room, prevent them from joining another
            if (roomData.participants.includes(userId)) {
                console.log(`User ${userId} is already in room ${roomDoc.id}. Cannot join another room.`);
                return res.status(400).json({ roomid: roomDoc.id,error: 'You are already in another room. Please leave the current room before joining a new one.' });
            }
        }

        // Step 2: Generate a management token
        const token = generateRoomToken();
        console.log("Generated Management Token:", token);

        // Step 3: Fetch all available rooms that are not full
        const availableRoomsQuery = await roomsRef.where('isFull', '==', false).get();

        let roomId;

        if (!availableRoomsQuery.empty) {
            // Iterate through available rooms to find one where the user is not already a participant
            for (const roomDoc of availableRoomsQuery.docs) {
                const roomData = roomDoc.data();

                // Use a transaction to safely update the room's participants
                try {
                    await db.runTransaction(async (transaction) => {
                        const roomSnapshot = await transaction.get(roomDoc.ref);
                        const roomData = roomSnapshot.data();

                        // Double-check if the room became full during the transaction
                        if (roomData.isFull) {
                            throw new Error("Room became full during transaction.");
                        }

                        // Add the user to the participants list
                        const updatedParticipants = [...new Set([...roomData.participants, userId])]; // Prevent duplicates
                        const isFull = updatedParticipants.length >= MAX_PARTICIPANTS;

                        transaction.update(roomDoc.ref, {
                            participants: updatedParticipants,
                            isFull: isFull,
                        });
                    });

                    roomId = roomDoc.id;
                    console.log(`User ${userId} joined existing room ${roomId}`);
                    break; // Exit the loop once a suitable room is found
                } catch (transactionError) {
                    console.warn(`Failed to join room ${roomDoc.id}: ${transactionError.message}`);
                    continue; // Try the next room
                }
            }
        }

        // Step 4: If no suitable room was found, create a new room
        if (!roomId) {
            roomId = await createRoom(token);

            // Store the new room in Firestore
            await roomsRef.doc(roomId).set({
                participants: [userId],
                isFull: false,
                createdAt: FieldValue.serverTimestamp(),
            });

            console.log(`Created new room ${roomId} for user ${userId}`);
        }

        // Step 5: Return the app-specific token, room ID, and participant list
        const roomSnapshot = await roomsRef.doc(roomId).get();
        const roomData = roomSnapshot.data();

        // Validate room data structure
        if (!roomData || !Array.isArray(roomData.participants)) {
            throw new Error("Invalid room data structure.");
        }

        const participentToken = generateParticipantToken(roomId, userId);

        res.json({
            roomID: roomId,
            participants: roomData.participants,
            token: participentToken,
        });
    } catch (error) {
        console.error('Error joining or creating room:', error.message || error);

        // Handle specific errors for better debugging
        if (error.message === "Invalid room data structure.") {
            res.status(500).json({ error: 'Unexpected database error. Please try again later.' });
        } else {
            res.status(500).json({ error: 'Failed to join or create room', details: error.message });
        }
    }
});
app.post('/leave-room', authenticateFirebaseToken, async (req, res) => {
    const userId = req.user.uid; // Extract user ID from Firebase token
    const { roomId } = req.body; // Room ID provided by the client

    if (!roomId) {
        return res.status(400).json({ error: 'Room ID is required.' });
    }

    const roomsRef = db.collection('rooms');
    const roomDocRef = roomsRef.doc(roomId);

    try {
        // Fetch the room document
        const roomSnapshot = await roomDocRef.get();
        if (!roomSnapshot.exists) {
            return res.status(404).json({ error: 'Room not found.' });
        }

        const roomData = roomSnapshot.data();

        // Check if the user is in the room's participants list
        if (!roomData.participants.includes(userId)) {
            return res.status(400).json({ error: 'You are not in this room.' });
        }

        // Use a transaction to safely update the room's participants
        await db.runTransaction(async (transaction) => {
            const roomSnapshot = await transaction.get(roomDocRef);
            const roomData = roomSnapshot.data();

            // Remove the user from the participants list
            const updatedParticipants = roomData.participants.filter(participant => participant !== userId);

            // Update the room state
            if (updatedParticipants.length === 0) {
                // Option 1: Delete the room if it becomes empty
                await transaction.delete(roomDocRef);
                console.log(`Room ${roomId} deleted because it became empty.`);
            } else {
                // Option 2: Update the room with the new participants list
                transaction.update(roomDocRef, {
                    participants: updatedParticipants,
                    isFull: false, // Room cannot be full if a user leaves
                });
                console.log(`User ${userId} left room ${roomId}. Updated participants:`, updatedParticipants);
            }
        });
        

        res.json({
            message: 'You have successfully left the room.',
            success: true,
            roomID: roomId,
           
        });
    } catch (error) {
        console.error('Error leaving room:', error.message || error);
        res.status(500).json({ error: 'Failed to leave the room.', details: error.message });
    }
});
const generateParticipantToken = (roomId, userId) => {
    const options = { expiresIn: '30m', algorithm: 'HS256' };
    const payload = {
        apikey: API_KEY,
        permissions: ["allow_join"], // Adjust permissions as needed
        version: 2,
        roomId: roomId,
        participantId: userId,
        roles: ['rtc']
    };
    const token = jwt.sign(payload, APP_SECRET, options);
    console.log("Generated Participant Token:", token);
    return token;
}



// Health check route
app.get('/', (req, res) => {
    res.send('Token Generation Server is running!');
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});