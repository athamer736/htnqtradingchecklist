-- Mentorship video platform tables (idempotent).
-- Safe to re-run. Apply via SQL Editor or `supabase db push` when linked.

-- === Video catalogue ========================================================
create table if not exists public.videos (
  id              uuid        primary key default gen_random_uuid(),
  bunny_video_id  text        not null unique,
  title           text        not null,
  description     text,
  level           int         not null check (level in (1, 2, 3)),
  duration_seconds int,
  thumbnail_url   text,
  published       boolean     not null default false,
  sort_ord        int         not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists videos_published_ord_idx
  on public.videos (published, sort_ord);

alter table public.videos enable row level security;

-- Clients may list published rows only when they pass the existing sync
-- membership helper. Playback still goes through issue-playback-token which
-- enforces fresher Discord + Railway checks. No client writes.
drop policy if exists "videos_select_published_members" on public.videos;
create policy "videos_select_published_members"
  on public.videos for select
  using (published = true and public.is_authorized_member());

-- === Discord role → video levels (server-written only) =====================
create table if not exists public.member_levels (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  discord_id  text        not null,
  levels      int[]       not null default '{}',
  checked_at  timestamptz not null default now()
);

alter table public.member_levels enable row level security;

drop policy if exists "member_levels_select_own" on public.member_levels;
create policy "member_levels_select_own"
  on public.member_levels for select
  using (user_id = auth.uid());

-- === Explicit staff video path (email/password; no fabricated customers) ===
create table if not exists public.video_staff_access (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  label      text        not null default 'HTNQ Staff',
  levels     int[]       not null default '{1,2,3}',
  granted_at timestamptz not null default now()
);

alter table public.video_staff_access enable row level security;

drop policy if exists "video_staff_select_own" on public.video_staff_access;
create policy "video_staff_select_own"
  on public.video_staff_access for select
  using (user_id = auth.uid());

-- === Minimal playback audit (service role writes; no client policies) ======
create table if not exists public.playback_audit (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null,
  discord_id      text,
  video_id        uuid,
  bunny_video_id  text,
  session_ref     text        not null,
  outcome         text        not null,
  reason_code     text,
  level_required  int,
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists playback_audit_user_created_idx
  on public.playback_audit (user_id, created_at desc);

alter table public.playback_audit enable row level security;
-- No policies: only service role (Edge Functions) can read/write.

-- Owner must choose retention (example: delete rows older than 90 days via
-- a scheduled job). Do not invent a legal retention period here.
