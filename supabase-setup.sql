-- QUICKROOM - CHẠY TOÀN BỘ FILE NÀY TRONG SUPABASE SQL EDITOR
-- Mô hình: mỗi tài khoản có một phòng riêng; đăng nhập cùng tài khoản trên nhiều thiết bị.

create extension if not exists pgcrypto;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sender_name text not null default 'Thiết bị',
  body text,
  image_path text,
  created_at timestamptz not null default now(),
  constraint messages_has_content check (
    nullif(trim(coalesce(body, '')), '') is not null or image_path is not null
  ),
  constraint messages_body_length check (char_length(coalesce(body, '')) <= 3000),
  constraint messages_sender_length check (char_length(sender_name) between 1 and 40)
);

create index if not exists messages_user_created_at_idx
  on public.messages (user_id, created_at desc);

alter table public.messages enable row level security;

-- Chỉ chủ tài khoản được đọc tin nhắn của chính mình.
drop policy if exists "Users can read own messages" on public.messages;
create policy "Users can read own messages"
on public.messages
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Chỉ được tạo tin nhắn mang đúng user_id của phiên đăng nhập.
drop policy if exists "Users can insert own messages" on public.messages;
create policy "Users can insert own messages"
on public.messages
for insert
to authenticated
with check ((select auth.uid()) = user_id);

-- Cho phép xóa tin nhắn của chính mình.
drop policy if exists "Users can delete own messages" on public.messages;
create policy "Users can delete own messages"
on public.messages
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Bucket ảnh riêng tư, giới hạn 6 MB mỗi file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images',
  'chat-images',
  false,
  6291456,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- File phải nằm trong thư mục có tên đúng bằng user_id.
drop policy if exists "Users can view own chat images" on storage.objects;
create policy "Users can view own chat images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can upload own chat images" on storage.objects;
create policy "Users can upload own chat images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can delete own chat images" on storage.objects;
create policy "Users can delete own chat images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Bật bảng messages cho Supabase Realtime.
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end $$;
