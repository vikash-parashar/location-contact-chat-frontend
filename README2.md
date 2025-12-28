Location Contact Chat Integration
================================

This directory contains the backend REST surface that powers the location↔contact chat flow consumed by the Chat Lab UI. Share this summary with the frontend team so they can call the same endpoints or mirror their payloads from Postman.

Base URL
--------

- Local development: `http://localhost:8000`
- Production/staging: whichever API URL the backend is deployed behind (the same domain as other `/api` endpoints).

Authentication
--------------

- Every endpoint requires a bearer token in `Authorization: Bearer <jwt>` issued by the main CRM auth system.
- The frontend obtains this token via the usual login flow and passes it with each request.
- Websocket connections reuse the same authentication token: connect to `ws://localhost:8000/ws?locationID=<locationID>` (or `wss` in prod) and include the `Authorization` header during the upgrade if the client library supports it.

Common concepts
---------------

- `location_id`: UUID of the location the contact belongs to.
- `contact_id`: UUID of the contact/patient; the service verifies the contact actually belongs to that location.
- `sender_type`: either `LOCATION` (staff/user) or `CONTACT` (patient portal). The backend enforces that only `location` clients post through the admin UI.
- `attachments`: optional array of external URLs (HTTPS) with metadata; each attachment is limited in size by `internal.MaxChatAttachmentSizeBytes` and there can only be `internal.MaxChatAttachments` entries.

Endpoints
---------

All endpoints live under `/location-contact-chat`.

### POST /location-contact-chat/messages

- **Purpose**: Send a new chat message from a location to a contact. Only location users (server-to-server) call this endpoint; patient messages come through websocket+token flows.
- **Headers**: `Authorization`, `Content-Type: application/json`.
- **Request JSON**:
  ```json
  {
    "location_id": "<uuid>",
    "contact_id": "<uuid>",
    "content": "Hi from the desktop UI",
    "content_type": "TEXT",             // optional, defaults to TEXT
    "sender_name": "Dr. Smith",        // optional; backend fills from user profile when omitted
    "attachments": [
      {
        "file_name": "report.pdf",
        "file_url": "https://cdn.example.com/report.pdf",
        "mime_type": "application/pdf",
        "size": 123456
      }
    ]
  }
  ```
- **Response**: HTTP 200 with the new message payload:
  ```json
  {
    "message": {
      "id": "...",
      "content": "...",
      "sender_type": "LOCATION",
      "attachments": [...],
      "created_at": "2025-12-28T...Z",
      "read_by_contact": false,
      ...
    }
  }
  ```

### GET /location-contact-chat/messages

- **Purpose**: Retrieve paginated history for a location/contact pair.
- **Query parameters**:
  - `locationID` (required)
  - `contactID` (required)
  - `limit` (optional, defaults to 50)
  - `offset` (optional)
  - `direction` (optional `LOCATION` or `CONTACT` to filter on sender)
  - `unreadBy` (optional `LOCATION` or `CONTACT` to fetch only unread messages for that reader)
  - `startTime` / `endTime` (RFC3339 timestamps)
- **Response**:
  ```json
  {
    "messages": [ {...}, ... ],
    "isLastPage": true
  }
  ```

### POST /location-contact-chat/messages/read

- **Purpose**: Mark inbound messages as read (the server marks `read_by_location` when a staff member opens the thread).
- **Body**: `{ "location_id": "...", "contact_id": "..." }`
- **Response**: `{ "status": "ok" }`

### DELETE /location-contact-chat/messages/{message_id}

- **Purpose**: Soft-delete a message the current user sent.
- **Response**: `{ "status": "deleted" }`

### GET /location-contact-chat/messages/unread-count

- Returns `{ "unread_by_location": n, "unread_by_contact": m }` for the pair.

### POST /location-contact-chat/tokens

- **Purpose**: Generate a patient chat token the contact portal uses to authenticate websocket/REST calls. This endpoint is only for location clients creating a new patient session.
- **Body**:
  ```json
  {
    "location_id": "...",
    "contact_id": "...",
    "expires_at": "2025-12-31T23:59:59Z" // optional
  }
  ```
- **Response**: `{ "token": "opaque-string" }`

### GET /location-contact-chat/tokens

- Returns the list of tokens (UUID + metadata) for a location/contact pair.

### POST /location-contact-chat/tokens/{token_id}/invalidate

- Invalidates a token so the contact portal can no longer connect with it. Useful after logout.

Websocket & Patient Flow
------------------------

- Patients connect to `ws://<host>/ws?locationID=<location>` and receive `refetch` events whenever `notifyLocation()` fires after a message is sent.
- Tokens generated above must be exchanged by the patient UI for `X-Patient-Chat-Token` headers on REST requests that read/write messages from the patient side.
- Backend validates tokens via `ValidatePatientToken`, which hashes the token and looks it up in `location_contact_chat_tokens`. Tokens are invalidated automatically once expired.

Database tables
---------------

- `location_contact_chat_messages`: stores each message, sender metadata, attachments flag, and read/deleted flags. Indexed by location/contact for fast fetches.
- `location_contact_chat_attachments`: stores URLs/metadata tied to `message_id`.
- `location_contact_chat_tokens`: hashed tokens for patient access. Include columns `is_active`, `expires_at`, `created_by`.

Notes for Frontend Dev
---------------------

1. Always include the same `Authorization: Bearer` token the backend request pipeline expects. There is no special `X-Auth` variant for chat.
2. Use the `/tokens` endpoints to manage patient sessions. The token string is returned only once and must be handed off to the patient UI securely.
3. The contact-facing UI can poll `GET /messages` or react to websocket `refetch` events to keep the thread fresh.
4. Respect attachment limits: secure HTTPS URLs only, positive sizes, and the configured `MaxChatAttachments` from the Go constant.

If you need concrete swagger or Postman collections, let me know the format and I can export the existing definitions for you.