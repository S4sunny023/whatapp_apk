# WA Sender

Zero-dependency Node.js (22+) backend + mobile-first PWA (Android pe "Install app" se APK jaisa chalta hai). Official WhatsApp Cloud API.

## Run
```
copy .env.example .env     # values edit karo
node server.js
```
Open http://localhost:3000 (default password `admin123` agar .env nahi). Bina WA_TOKEN ke **TEST MODE** hai (msgs actual me nahi jaate).

## Live setup
1. developers.facebook.com → Create App (Business) → add WhatsApp.
2. API Setup se **Phone Number ID** aur **Token** (permanent: System User token) `.env` me daalo.
3. Webhook URL: `https://<your-domain>/webhook`, verify token = `WEBHOOK_VERIFY_TOKEN`; subscribe to `messages`.
4. Message Templates banao (Meta Manager) → approve hone ke baad "Template" type se bhejo.
5. Server public HTTPS pe deploy karo (Railway/Render/VPS). Phone Chrome me kholo → Add to Home screen.

