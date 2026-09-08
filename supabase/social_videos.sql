create table if not exists public.social_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  caption text,
  telegram_file_id text not null,
  telegram_message_id bigint not null,
  telegram_chat_id text not null,
  mime_type text not null,
  original_filename text,
  file_size bigint,
  width integer,
  height integer,
  duration_seconds integer,
  created_at timestamptz not null default now()
);

create index if not exists social_videos_created_at_idx
  on public.social_videos (created_at desc);

create index if not exists social_videos_user_created_at_idx
  on public.social_videos (user_id, created_at desc);

alter table public.social_videos enable row level security;

drop policy if exists "social_videos_select_authenticated" on public.social_videos;
create policy "social_videos_select_authenticated"
  on public.social_videos for select to authenticated
  using (true);

drop policy if exists "social_videos_insert_own" on public.social_videos;
create policy "social_videos_insert_own"
  on public.social_videos for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "social_videos_update_own" on public.social_videos;
create policy "social_videos_update_own"
  on public.social_videos for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "social_videos_delete_own" on public.social_videos;
create policy "social_videos_delete_own"
  on public.social_videos for delete to authenticated
  using (auth.uid() = user_id);
