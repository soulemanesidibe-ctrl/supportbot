-- Relève IA : base de connaissance (fiches et morceaux vectorisés).
-- MIGRATION À APPLIQUER PAR LE FONDATEUR, après 20261106100300_support_et_connecteurs.sql.

create table public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 200),
  category text check (category = any (private.categories())),
  source text not null default 'manual' check (source in ('manual', 'import', 'ticket', 'seed')),
  source_ref text,
  -- Une fiche n'est consultable par l'agent qu'une fois VALIDÉE par un humain (menace M08, empoisonnement).
  status text not null default 'draft' check (status in ('draft', 'validated', 'archived')),
  version int not null default 1 check (version >= 1),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id),
  validated_by uuid references auth.users (id),
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'validated' or (validated_by is not null and validated_at is not null))
);
create index kb_documents_org_status_idx on public.kb_documents (org_id, status);
create trigger kb_documents_updated_at before update on public.kb_documents
  for each row execute function private.set_updated_at();

-- Le validateur doit être une personne habilitée de l'organisation (jamais l'agent, jamais un salarié).
create function private.kb_documents_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then raise exception 'org_id est immuable'; end if;
  if new.status = 'validated' and not (
       private._member(new.validated_by, new.org_id, array['org_admin', 'org_technician'])
       or private._partner_can_access(new.validated_by, new.org_id, 'partner_technician')
       or private._partner_can_access(new.validated_by, new.org_id, 'partner_admin')) then
    raise exception 'Une fiche ne peut être validée que par un technicien ou un administrateur habilité'; end if;
  return new;
end $$;
create trigger kb_documents_guard before insert or update on public.kb_documents
  for each row execute function private.kb_documents_guard();
create trigger audit_kb_documents after insert or update or delete on public.kb_documents
  for each row execute function private.audit_change();

create table public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid not null references public.kb_documents (id) on delete cascade,
  chunk_index int not null check (chunk_index >= 0),
  content text not null check (char_length(content) between 1 and 8000),
  token_count int,
  embedding extensions.vector(1024),                     -- vecteur de mistral-embed ; nul tant qu'il n'est pas calculé
  embedded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);
create index kb_chunks_org_idx on public.kb_chunks (org_id);
create index kb_chunks_embedding_hnsw on public.kb_chunks using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create function private.kb_chunks_guard() returns trigger
language plpgsql set search_path = '' as
$$
begin
  if not exists (select 1 from public.kb_documents d where d.id = new.document_id and d.org_id = new.org_id) then
    raise exception 'Le morceau doit appartenir à l''organisation de sa fiche (isolation de la base vectorielle)'; end if;
  return new;
end $$;
create trigger kb_chunks_guard before insert or update on public.kb_chunks
  for each row execute function private.kb_chunks_guard();

-- Recherche vectorielle. FILTRÉE PAR ORGANISATION À L'INTÉRIEUR DE LA FONCTION : même appelée avec la clé service_role
-- (qui contourne la RLS), elle ne renvoie jamais une fiche d'une autre organisation. Seules les fiches validées sont lues.
create function public.match_kb_chunks(
  p_org uuid, p_query extensions.vector(1024), p_limit int default 5, p_min_score float default 0.0)
returns table (chunk_id uuid, document_id uuid, title text, content text, score float)
language sql stable security invoker set search_path = '' as
$$
  select c.id, c.document_id, d.title, c.content,
         (1 - (c.embedding operator(extensions.<=>) p_query))::float as score
  from public.kb_chunks c
  join public.kb_documents d on d.id = c.document_id
  where c.org_id = p_org and d.org_id = p_org
    and d.status = 'validated' and c.embedding is not null
    and (1 - (c.embedding operator(extensions.<=>) p_query)) >= p_min_score
  order by c.embedding operator(extensions.<=>) p_query
  limit least(greatest(p_limit, 1), 20)
$$;
revoke all on function public.match_kb_chunks(uuid, extensions.vector, int, float) from public, anon;
grant execute on function public.match_kb_chunks(uuid, extensions.vector, int, float) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['kb_documents', 'kb_chunks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy kb_documents_read on public.kb_documents for select to authenticated using (private.can_read_org_config(org_id));
create policy kb_chunks_read on public.kb_chunks for select to authenticated using (private.can_read_org_config(org_id));
