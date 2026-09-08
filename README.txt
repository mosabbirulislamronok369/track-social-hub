1. Supabase SQL Editor-এ supabase/social_videos.sql চালাও।

2. Files:
src/app/lib/socialVideos.ts
src/app/api/social/videos/upload/route.ts

3. Existing env-ই যথেষ্ট:
TELEGRAM_BOT_TOKEN
TELEGRAM_STORAGE_CHAT_ID
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

4. Upload endpoint:
POST /api/social/videos/upload

multipart/form-data:
video = video file
title = optional
caption = optional

Header:
Authorization: Bearer <current Supabase access token>

Browser থেকে token:
const { data: { session } } = await supabase.auth.getSession();

তারপর Authorization header পাঠাবে।

Flow:
Browser -> API -> verify user -> Telegram upload -> social_videos metadata insert.

Telegram token client-side যাবে না।
