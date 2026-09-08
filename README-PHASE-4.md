# Social Phase 4 — Secure Telegram Upload Worker

## What changes

Phase 4 moves the video upload away from the Vercel API route.

New architecture:

Browser
  ↓
Cloudflare Worker
  ↓
Telegram Channel
  ↓
Telegram file_id
  ↓
Vercel metadata endpoint
  ↓
Supabase `social_videos`

Supabase Storage is not used for the video binary.

## Important security rule

Do NOT put `TELEGRAM_BOT_TOKEN` in any `NEXT_PUBLIC_*` variable.

The Telegram bot token stays inside Cloudflare Worker secrets.

The worker also uses a separate `UPLOAD_SECRET`.

## 1. Create the Worker

Open the `worker` folder.

Install:

npm install

Login:

npx wrangler login

Deploy:

npx wrangler deploy

## 2. Add Worker secrets

Run:

npx wrangler secret put TELEGRAM_BOT_TOKEN

Paste the existing Telegram bot token when prompted.

Then:

npx wrangler secret put TELEGRAM_CHANNEL_ID

Paste the existing channel ID, for example:
-100xxxxxxxxxx

Then:

npx wrangler secret put UPLOAD_SECRET

Generate a long random secret and paste it.

Do NOT commit these values.

## 3. Get the Worker URL

After deploy, Wrangler will print a URL similar to:

https://track-social-telegram-upload.<your-subdomain>.workers.dev

Use your actual URL.

## 4. Vercel environment variables

Add:

NEXT_PUBLIC_TELEGRAM_UPLOAD_URL=https://YOUR-WORKER-URL

and:

NEXT_PUBLIC_TELEGRAM_UPLOAD_SECRET=THE_SAME_UPLOAD_SECRET

Set both for Production (and Preview if you test Preview).

Important:
`NEXT_PUBLIC_TELEGRAM_UPLOAD_SECRET` is visible to the browser. This is therefore NOT a high-security secret. It only acts as a basic worker gate.

For stronger production security, Phase 5 should replace this static browser-visible secret with short-lived signed upload authorization.

## 5. Deploy the Next.js app

Replace:

src/app/components/Social.tsx

and add:

src/app/api/social/videos/metadata/route.ts

Then:

npm run build

git add .
git commit -m "Add direct Telegram upload worker"
git push

## 6. Existing variables

You do NOT need to create another bot or another channel.

Your existing:
TELEGRAM_BOT_TOKEN
YOUR_CHANNEL_ID

are reused.

The Worker uses:
TELEGRAM_BOT_TOKEN
TELEGRAM_CHANNEL_ID

So the value of `TELEGRAM_CHANNEL_ID` should be the same value you already use as `YOUR_CHANNEL_ID`.

## Important limitation

This is a separate upload service, but Telegram's Bot API still has its own maximum upload/file constraints, and Cloudflare Worker request/streaming behavior can impose limits depending on the plan/runtime.

For truly large production video uploads, Phase 5 should use a dedicated resumable upload architecture rather than assuming one giant multipart request is unlimited.

## Supabase

No Storage bucket is needed for video files.

`social_videos` remains the metadata/index table.
