-- Banksync · esquema de Supabase
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run.
-- Es idempotente: se puede volver a ejecutar para actualizar las funciones.
--
-- Modelo de seguridad
--   * No hay usuarios. Una cuenta compartida se identifica por el SHA-256
--     de su código (calculado en el navegador). El servidor nunca ve el código.
--   * Las tablas no son accesibles desde la API: RLS activado sin políticas
--     y sin permisos para anon/authenticated.
--   * Todo pasa por funciones SECURITY DEFINER que exigen el hash del código.
--     Sin código no se puede leer, listar ni escribir nada.

create table if not exists public.bs_ledgers (
  id               text primary key check (id ~ '^[0-9a-f]{64}$'),
  meta             jsonb not null default '{}'::jsonb
                   check (pg_column_size(meta) < 4096),
  meta_updated_at  timestamptz not null default 'epoch',
  created_at       timestamptz not null default now(),
  touched_at       timestamptz not null default now()
);

create sequence if not exists public.bs_rev;

create table if not exists public.bs_entries (
  id          uuid primary key,
  ledger_id   text not null references public.bs_ledgers (id) on delete cascade,
  data        jsonb not null check (pg_column_size(data) < 2048),
  updated_at  timestamptz not null,
  deleted     boolean not null default false,
  rev         bigint not null default nextval('public.bs_rev')
);

create index if not exists bs_entries_ledger_rev on public.bs_entries (ledger_id, rev);

alter table public.bs_ledgers enable row level security;
alter table public.bs_entries enable row level security;
revoke all on public.bs_ledgers, public.bs_entries from anon, authenticated;
revoke all on sequence public.bs_rev from anon, authenticated;

-- Sincronización en un solo viaje:
--   1. (opcional) crea la cuenta si p_create y no existe
--   2. actualiza meta si la recibida es más reciente
--   3. inserta / actualiza movimientos (gana el más reciente)
--   4. devuelve meta y los movimientos con rev > p_since
create or replace function public.bs_sync(
  p_ledger  text,
  p_since   bigint      default 0,
  p_meta    jsonb       default null,
  p_meta_at timestamptz default null,
  p_entries jsonb       default '[]'::jsonb,
  p_create  boolean     default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger public.bs_ledgers;
  v_created boolean := false;
begin
  if p_ledger is null or p_ledger !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid ledger' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_entries, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) > 500 then
    raise exception 'invalid entries' using errcode = '22023';
  end if;

  select * into v_ledger from public.bs_ledgers where id = p_ledger for update;

  if not found then
    if not p_create then
      return jsonb_build_object('exists', false);
    end if;
    insert into public.bs_ledgers (id, meta, meta_updated_at)
    values (p_ledger, coalesce(p_meta, '{}'::jsonb), coalesce(p_meta_at, now()))
    returning * into v_ledger;
    v_created := true;
  elsif p_meta is not null and p_meta_at is not null
        and p_meta_at > v_ledger.meta_updated_at then
    update public.bs_ledgers
       set meta = p_meta, meta_updated_at = p_meta_at, touched_at = now()
     where id = p_ledger
    returning * into v_ledger;
  end if;

  insert into public.bs_entries as e (id, ledger_id, data, updated_at, deleted)
  select (x->>'id')::uuid,
         p_ledger,
         coalesce(x->'data', '{}'::jsonb),
         (x->>'at')::timestamptz,
         coalesce((x->>'del')::boolean, false)
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as x
  on conflict (id) do update
     set data = excluded.data,
         updated_at = excluded.updated_at,
         deleted = excluded.deleted,
         rev = nextval('public.bs_rev')
   where e.ledger_id = excluded.ledger_id
     and e.updated_at < excluded.updated_at;

  if jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) > 0 and not v_created then
    update public.bs_ledgers set touched_at = now() where id = p_ledger;
  end if;

  return jsonb_build_object(
    'exists',  true,
    'created', v_created,
    'meta',    v_ledger.meta,
    'meta_at', v_ledger.meta_updated_at,
    'rev',     coalesce((select max(rev) from public.bs_entries where ledger_id = p_ledger), 0),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', id, 'data', data, 'at', updated_at, 'del', deleted, 'rev', rev)
             order by rev)
        from public.bs_entries
       where ledger_id = p_ledger and rev > coalesce(p_since, 0)
    ), '[]'::jsonb)
  );
end;
$$;

-- Borra una cuenta compartida y todos sus movimientos del servidor.
create or replace function public.bs_delete(p_ledger text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ledger is null or p_ledger !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid ledger' using errcode = '22023';
  end if;
  delete from public.bs_ledgers where id = p_ledger;
  return found;
end;
$$;

revoke all on function public.bs_sync(text, bigint, jsonb, timestamptz, jsonb, boolean) from public;
revoke all on function public.bs_delete(text) from public;
grant execute on function public.bs_sync(text, bigint, jsonb, timestamptz, jsonb, boolean) to anon, authenticated;
grant execute on function public.bs_delete(text) to anon, authenticated;
