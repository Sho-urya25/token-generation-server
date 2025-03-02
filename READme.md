# Random Video Chat Backend

## Overview
This is the backend service for a random video chat application. It uses Express.js for handling API requests, Firebase for authentication and Firestore for room management, and 100ms for video chat rooms.

## Features
- Firebase Authentication for secure access
- Room management using Firestore
- 100ms API integration for video chat
- JWT-based token generation for authentication
- REST API endpoints for room creation, joining, and leaving

## Tech Stack
- Node.js
- Express.js
- Firebase Admin SDK
- Firestore Database
- 100ms Video API
- JWT Authentication
- Axios for HTTP requests

## Prerequisites
Before running the server, ensure you have the following:
- Node.js installed
- Firebase project set up
- 100ms developer account
- `.env` file with the following environment variables:

```env
PORT=3000
APP_ACCESS_KEY=<your_hms_app_access_key>
APP_SECRET=<your_hms_app_secret>
HMS_TEMPLATE_ID=<your_hms_template_id>
```

- Firebase service account JSON file at `/etc/secrets/service.json`

## Installation
1. Clone the repository:
   ```sh
   git clone <repository-url>
   cd <project-directory>
   ```
2. Install dependencies:
   ```sh
   npm install
   ```
3. Run the server:
   ```sh
   node server.js
   ```

## API Endpoints

### Health Check
- **GET /**
- Response: `"Token Generation Server is running!"`

### Generate App Token
- **POST /generate-app-token**
- Headers: `Authorization: Bearer <Firebase_ID_Token>`
- Response:
  ```json
  {
    "token": "<generated_token>",
    "roomID": "<room_id>"
  }
  ```

### Leave Room
- **POST /leave-room**
- Body:
  ```json
  {
    "roomId": "<room_id>",
    "userId": "<firebase_user_id>"
  }
  ```
- Response:
  ```json
  { "message": "User successfully left the room" }
  ```

## License
This project is licensed under the MIT License.

