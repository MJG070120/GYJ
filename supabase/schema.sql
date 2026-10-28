-- ============================================================
-- 光影集 · LUMIÈRE — Supabase 初始化脚本
--
-- 在 Supabase Dashboard → SQL Editor 里整段粘贴执行一次。
-- 访客只读；注册用户可上传；只能改/删自己的作品；
-- profiles.is_admin = true 的管理员可以管理全部作品。
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------ profiles

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
on public.profiles for select
using (true);

grant select on public.profiles to anon, authenticated;

-- 新用户注册时自动创建资料行
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        '用户'
      ),
      40
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 只允许改自己的昵称；is_admin 只能由 SQL / 管理端设置
create or replace function public.set_display_name(new_name text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set display_name = left(coalesce(nullif(trim(new_name), ''), '用户'), 40)
  where id = auth.uid();
$$;

revoke all on function public.set_display_name(text) from public;
grant execute on function public.set_display_name(text) to authenticated;

-- 管理员判断
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- -------------------------------------------------------------- photos

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  owner_name text not null default '',
  title text not null default '',
  caption text not null default '',
  film text not null default '',
  location text not null default '',
  tags text[] not null default '{}'::text[],
  width integer not null check (width between 1 and 30000),
  height integer not null check (height between 1 and 30000),
  exif jsonb not null default '{}'::jsonb,
  full_path text not null,
  thumb_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists photos_created_at_idx on public.photos (created_at desc);
create index if not exists photos_owner_idx on public.photos (owner_id);

alter table public.photos enable row level security;

drop policy if exists "photos are publicly readable" on public.photos;
create policy "photos are publicly readable"
on public.photos for select
using (true);

drop policy if exists "authenticated users can insert their own photos" on public.photos;
create policy "authenticated users can insert their own photos"
on public.photos for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "owners and admins can update photos" on public.photos;
create policy "owners and admins can update photos"
on public.photos for update
to authenticated
using (owner_id = auth.uid() or public.is_admin())
with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists "owners and admins can delete photos" on public.photos;
create policy "owners and admins can delete photos"
on public.photos for delete
to authenticated
using (owner_id = auth.uid() or public.is_admin());

grant select on public.photos to anon, authenticated;
grant insert, update, delete on public.photos to authenticated;

-- 作者名由资料表决定，避免用户伪造
create or replace function public.set_photo_owner_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.owner_name := coalesce(
    (select p.display_name from public.profiles p where p.id = new.owner_id),
    nullif(trim(new.owner_name), ''),
    '匿名用户'
  );
  return new;
end;
$$;

drop trigger if exists photos_set_owner_name on public.photos;
create trigger photos_set_owner_name
before insert or update on public.photos
for each row execute function public.set_photo_owner_name();

-- ------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 10485760, array['image/jpeg'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "photos bucket public read" on storage.objects;
create policy "photos bucket public read"
on storage.objects for select
using (bucket_id = 'photos');

drop policy if exists "photos bucket authenticated upload" on storage.objects;
create policy "photos bucket authenticated upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "photos bucket owner update" on storage.objects;
create policy "photos bucket owner update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'photos'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
)
with check (
  bucket_id = 'photos'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "photos bucket owner delete" on storage.objects;
create policy "photos bucket owner delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'photos'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

-- --------------------------------------------------------------- 管理员
--
-- 1. 先在网站注册一个账号并完成邮箱验证；
-- 2. 把下面的邮箱改成你的管理员邮箱，取消注释后执行；
-- 3. 重新登录（或刷新页面），菜单里会出现「管理员」。
--
-- update public.profiles
-- set is_admin = true
-- where id = (
--   select id from auth.users where email = 'you@example.com'
-- );
