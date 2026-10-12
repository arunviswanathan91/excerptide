-- Apply once to the same Supabase project as the personal dashboard.
create table public.clippings (
 id uuid primary key,
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 original_url text not null check (original_url ~ '^https?://'),
 page_key text not null,
 title text not null default '',
 anchor jsonb not null check (jsonb_typeof(anchor) = 'object' and coalesce(length(anchor->>'exact'),0) between 1 and 100000),
 doi text, pmid text, pmcid text,
 notes text not null default '',
 tags text[] not null default '{}',
 color text not null default 'yellow',
 zotero jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index clippings_owner_page on public.clippings(user_id,page_key);
create index clippings_owner_created on public.clippings(user_id,created_at,id);
alter table public.clippings enable row level security;
revoke all on public.clippings from anon;
grant select,insert,update,delete on public.clippings to authenticated;
create policy clippings_select on public.clippings for select to authenticated using ((select auth.uid())=user_id);
create policy clippings_insert on public.clippings for insert to authenticated with check ((select auth.uid())=user_id);
create policy clippings_update on public.clippings for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy clippings_delete on public.clippings for delete to authenticated using ((select auth.uid())=user_id);
create function public.excerptide_touch() returns trigger language plpgsql security invoker set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
revoke all on function public.excerptide_touch() from public;
create trigger clippings_updated before update on public.clippings for each row execute function public.excerptide_touch();
