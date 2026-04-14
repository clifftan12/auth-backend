# auth-backend

Auth API backend for iinite email and phone verification.

## Endpoints

- `GET /`
- `GET /health`
- `POST /auth/email/start`
- `POST /auth/email/verify`
- `POST /auth/phone/start`
- `POST /auth/phone/verify`

## Local setup

```bash
cd /Users/clifftan/auth-backend
cp .env.example .env
/opt/homebrew/bin/npm install
/opt/homebrew/bin/npm start
```

Runs on:

- `http://localhost:3000`

## Environment variables

- `PORT`
- `NODE_ENV`
- `FRONTEND_BASE_URL`
- `ALLOWED_ORIGINS`
- `ALLOW_PREVIEW_CODE`

`ALLOW_PREVIEW_CODE=true` is only for local testing. For a public deployment, set:

```bash
NODE_ENV=production
ALLOW_PREVIEW_CODE=false
```

## Real verification providers

### SMS via Twilio Verify

Set:

```bash
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_VERIFY_SERVICE_SID=your_verify_service_sid
```

### Email via SendGrid-compatible API

Set:

```bash
EMAIL_PROVIDER_API_KEY=your_sendgrid_api_key
EMAIL_PROVIDER_FROM=no-reply@yourdomain.com
EMAIL_PROVIDER_API_URL=https://api.sendgrid.com/v3/mail/send
```

When these are configured and `ALLOW_PREVIEW_CODE=false`, the backend stops returning preview codes and sends real verification messages instead.

## Example requests

Start email verification:

```bash
curl -X POST http://localhost:3000/auth/email/start \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","mode":"signUp"}'
```

Start phone verification:

```bash
curl -X POST http://localhost:3000/auth/phone/start \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+6581234567","mode":"signUp"}'
```

## Deploy

Deploy this as a standard Node.js web service on Render, Railway, Fly.io, or any HTTPS host.

### Render

This repo now includes [render.yaml](/Users/clifftan/auth-backend/render.yaml), so you can deploy it as a Render Blueprint or copy the same settings into a normal Render Web Service.

Render settings:

- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Production requirements:

- public HTTPS URL
- `NODE_ENV=production`
- `ALLOW_PREVIEW_CODE=false`
- `ALLOWED_ORIGINS` set to your real app web origin if needed
- configure Twilio Verify and a real email provider before App Review
