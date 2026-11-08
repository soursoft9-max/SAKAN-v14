-- =====================================================================
-- سَكَن | تحديث قاعدة البيانات إلى آخر إصدار **بدون حذف أي بيانات**
-- يضيف: تصريح "خروج بموافقة ولي الأمر"، رابط موافقة ولي الأمر، حفظ البطاقات وأرشيفها، ورسائل واتساب.
-- يُشغَّل على قاعدة بُنيت بإصدار سابق. تشغيله أكثر من مرة آمن.
-- (للبناء من الصفر استخدم 00-sakan-schema.sql، وهو يحذف كل شيء)
-- =====================================================================

-- 1. أعمدة البطاقات المحفوظة في ملف الطالبة
alter table public.profiles
  add column if not exists student_card_path   text,
  add column if not exists student_card_name   text,
  add column if not exists student_card_civil  text,
  add column if not exists guardian_card_path  text,
  add column if not exists guardian_card_name  text,
  add column if not exists guardian_card_civil text,
  add column if not exists cards_updated_at    timestamptz;

-- 2. نوع التصريح الجديد وحالة "بانتظار ولي الأمر"
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.service_requests'::regclass and contype = 'c'
              and (pg_get_constraintdef(oid) ilike '%request_type%' or pg_get_constraintdef(oid) ilike '%(status%')
              and pg_get_constraintdef(oid) not ilike '%security_status%'
              and pg_get_constraintdef(oid) not ilike '%guardian_status%'
  loop
    execute format('alter table public.service_requests drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.service_requests
  add constraint service_requests_request_type_check
    check (request_type in ('exit_permit','guardian_exit','hosting','dorm_transfer','room_change')),
  add constraint service_requests_status_check
    check (status in ('pending_guardian','pending_supervisor','pending_admin','approved','rejected','cancelled','completed'));

-- 3. أعمدة رد ولي الأمر
alter table public.service_requests
  add column if not exists guardian_status     text check (guardian_status in ('pending','sent','approved','rejected','failed')),
  add column if not exists guardian_phone      text,
  add column if not exists guardian_token      text unique,
  add column if not exists guardian_message_id text,
  add column if not exists guardian_sent_at    timestamptz,
  add column if not exists guardian_send_count int not null default 0,
  add column if not exists guardian_replied_at timestamptz,
  add column if not exists guardian_reply      text,
  add column if not exists guardian_channel    text,
  add column if not exists guardian_error      text;

-- 4. أرشيف البطاقات
create table if not exists public.id_cards (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('student','guardian')),
  image_path  text not null,
  full_name   text,
  civil_id    text,
  request_id  uuid,
  uploaded_at timestamptz not null default now()
);
create index if not exists id_cards_student_idx on public.id_cards (student_id, uploaded_at desc);
alter table public.id_cards enable row level security;

-- روابط موافقة ولي الأمر (ترسلها المشرفة على واتساب)
create table if not exists public.guardian_links (
  request_id uuid primary key references public.service_requests(id) on delete cascade,
  token      text not null unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  opened_at  timestamptz
);
alter table public.guardian_links enable row level security;

-- البطاقات المرفقة في التصاريح السابقة تصبح "محفوظة" في ملف الطالبة
update public.profiles p set
  student_card_path  = x.details #>> '{student_card,image_path}',
  student_card_name  = x.details #>> '{student_card,full_name}',
  student_card_civil = x.details #>> '{student_card,id_number}',
  guardian_card_path  = x.details #>> '{guardian_card,image_path}',
  guardian_card_name  = x.details #>> '{guardian_card,full_name}',
  guardian_card_civil = x.details #>> '{guardian_card,id_number}',
  cards_updated_at = x.created_at
from (select distinct on (student_id) student_id, details, created_at
        from public.service_requests
       where details #>> '{student_card,image_path}' is not null
         and details #>> '{guardian_card,image_path}' is not null
       order by student_id, created_at desc) x
where p.id = x.student_id and p.student_card_path is null;

insert into public.id_cards (student_id, kind, image_path, full_name, civil_id, request_id, uploaded_at)
select r.student_id, k.kind, r.details #>> array[k.kind || '_card','image_path'],
       r.details #>> array[k.kind || '_card','full_name'], r.details #>> array[k.kind || '_card','id_number'], r.id, r.created_at
  from public.service_requests r cross join (values ('student'), ('guardian')) k(kind)
 where r.details #>> array[k.kind || '_card','image_path'] is not null
   and not exists (select 1 from public.id_cards c where c.request_id = r.id and c.kind = k.kind);

-- 5. الدوال (نفس ملف البناء الكامل)
create or replace function public.sakan_today()
returns date language sql stable
as $$ select (now() at time zone 'Asia/Muscat')::date $$;

create or replace function public.sakan_normalize_phone(p_phone text)
returns text language sql immutable
as $$
  select case
    when d = '' then null
    when length(d) = 8 then '968' || d
    else d
  end
  from (select regexp_replace(regexp_replace(translate(coalesce(p_phone, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g'), '^00', '') as d) x
$$;

create or replace function public.sakan_user_role()
returns text language sql stable security definer set search_path = public
as $$ select role from profiles where id = auth.uid() and is_active $$;

create or replace function public.sakan_user_dormitory()
returns uuid language sql stable security definer set search_path = public
as $$ select dormitory_id from profiles where id = auth.uid() $$;

create or replace function public.sakan_normalize_username(p_username text)
returns text language sql immutable
as $$
  select lower(regexp_replace(translate(coalesce(p_username, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\s', '', 'g'))
$$;

create or replace function public.sakan_username_role(p_username text)
returns text language sql immutable
as $$
  select case
    when sakan_normalize_username(p_username) ~ '^[0-9]{3,20}$' then 'student'
    when sakan_normalize_username(p_username) ~ '^(supervisor|security|admin)@[a-z0-9][a-z0-9._-]{1,39}$'
      then split_part(sakan_normalize_username(p_username), '@', 1)
  end
$$;

create or replace function public.sakan_login_email(p_username text)
returns text language sql immutable
as $$
  select case
    when sakan_username_role(p_username) is null then null
    when sakan_username_role(p_username) = 'student' then 's' || sakan_normalize_username(p_username) || '@sakan.local'
    else replace(sakan_normalize_username(p_username), '@', '.') || '@sakan.local'
  end
$$;

create or replace function public.sakan_guard_new_user()
returns trigger language plpgsql
as $$
begin
  if coalesce(current_setting('sakan.creating_user', true), '') <> '1' then
    raise exception 'إنشاء الحسابات يتم من لوحة الإدارة فقط';
  end if;
  return new;
end $$;

create or replace function public.sakan_guard_profile_update()
returns trigger language plpgsql
as $$
begin
  if new.role is distinct from old.role or new.username is distinct from old.username then
    raise exception 'نوع الحساب واسم الدخول لا يتغيران بعد الإنشاء';
  end if;
  if new.role = 'student' then
    new.student_number := new.username;
  end if;
  return new;
end $$;

create or replace function public.sakan_create_account_internal(
  p_username text, p_password text, p_full_name text, p_details jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_username text := sakan_normalize_username(p_username);
  v_role text := sakan_username_role(p_username);
  v_email text := sakan_login_email(p_username);
  v_id uuid := gen_random_uuid();
  d jsonb := coalesce(p_details, '{}'::jsonb);
  v_dorm uuid := nullif(d->>'dormitory_id', '')::uuid;
  v_room uuid := nullif(d->>'room_id', '')::uuid;
  v_room_row rooms;
  v_used int;
  c text;
begin
  if v_role is null then
    raise exception 'اسم الدخول غير صالح: للطالبة الرقم الجامعي، وللعاملين الدور ثم @ ثم اسم بحروف إنجليزية، مثل supervisor@mariam أو security@gate1 أو admin@ahmed';
  end if;
  if coalesce(length(p_password), 0) < 6 then
    raise exception 'كلمة المرور يجب ألا تقل عن 6 أحرف';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'اكتبي الاسم الكامل';
  end if;
  if exists (select 1 from profiles where username = v_username) or exists (select 1 from auth.users where email = v_email) then
    raise exception 'اسم الدخول % مستخدم مسبقاً', v_username;
  end if;
  if v_role = 'supervisor' and v_dorm is null then
    raise exception 'حددي سكن المشرفة';
  end if;
  if v_role not in ('student','supervisor') then v_dorm := null; end if;
  if v_role <> 'student' then v_room := null; end if;
  if v_room is not null then
    select * into v_room_row from rooms where id = v_room and is_active;
    if not found then raise exception 'الغرفة غير موجودة'; end if;
    v_dorm := v_room_row.dormitory_id;
    select count(*) into v_used from profiles where room_id = v_room and role = 'student' and is_active;
    if v_used >= v_room_row.capacity then raise exception 'الغرفة % ممتلئة', v_room_row.room_number; end if;
  end if;
  if nullif(trim(d->>'fingerprint_id'), '') is not null
     and exists (select 1 from profiles where fingerprint_id = trim(d->>'fingerprint_id')) then
    raise exception 'رقم البصمة % مستخدم لطالبة أخرى', trim(d->>'fingerprint_id');
  end if;

  perform set_config('sakan.creating_user', '1', true);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
          jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
          jsonb_build_object('username', v_username, 'full_name', trim(p_full_name)),
          now(), now());

  foreach c in array array['confirmation_token','recovery_token','email_change_token_new',
                           'email_change_token_current','email_change','phone_change',
                           'phone_change_token','reauthentication_token'] loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'auth' and table_name = 'users' and column_name = c) then
      execute format('update auth.users set %I = coalesce(%I, '''') where id = $1', c, c) using v_id;
    end if;
  end loop;

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  insert into profiles (id, username, full_name, email, role, student_number, civil_id, phone,
                        guardian_name, guardian_phone, dormitory_id, room_id, fingerprint_id, is_active)
  values (v_id, v_username, trim(p_full_name), v_email, v_role,
          case when v_role = 'student' then v_username end,
          nullif(trim(d->>'civil_id'), ''), nullif(trim(d->>'phone'), ''),
          nullif(trim(d->>'guardian_name'), ''), nullif(trim(d->>'guardian_phone'), ''),
          v_dorm, v_room,
          case when v_role = 'student' then nullif(trim(d->>'fingerprint_id'), '') end,
          true);

  perform set_config('sakan.creating_user', '', true);
  return v_id;
end $$;

create or replace function public.sakan_admin_create_account(
  p_username text, p_password text, p_full_name text, p_details jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if sakan_user_role() is distinct from 'admin' then raise exception 'ليست لديك صلاحية لهذا الإجراء'; end if;
  v_id := sakan_create_account_internal(p_username, p_password, p_full_name, p_details);
  insert into audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'account_create', 'profile', v_id, jsonb_build_object('username', sakan_normalize_username(p_username)));
  return jsonb_build_object('id', v_id, 'username', sakan_normalize_username(p_username), 'role', sakan_username_role(p_username));
end $$;

create or replace function public.sakan_admin_set_password(p_user_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  if sakan_user_role() is distinct from 'admin' then raise exception 'ليست لديك صلاحية لهذا الإجراء'; end if;
  if coalesce(length(p_password), 0) < 6 then raise exception 'كلمة المرور يجب ألا تقل عن 6 أحرف'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user_id;
  if not found then raise exception 'الحساب غير موجود'; end if;
  insert into audit_logs (actor_id, action, entity_type, entity_id) values (auth.uid(), 'account_password', 'profile', p_user_id);
end $$;

create or replace function public.sakan_admin_delete_account(p_user_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if sakan_user_role() is distinct from 'admin' then raise exception 'ليست لديك صلاحية لهذا الإجراء'; end if;
  if p_user_id = auth.uid() then raise exception 'لا يمكنك حذف حسابك'; end if;
  delete from auth.users where id = p_user_id;
  if not found then raise exception 'الحساب غير موجود'; end if;
  insert into audit_logs (actor_id, action, entity_type, entity_id) values (auth.uid(), 'account_delete', 'profile', p_user_id);
end $$;

create or replace function public.sakan_before_request_insert()
returns trigger language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_room rooms;
  v_used int;
begin
  select dormitory_id, room_id into new.source_dormitory_id, new.source_room_id
  from profiles where id = new.student_id;

  if new.request_type in ('room_change','dorm_transfer') then
    if new.source_dormitory_id is null then raise exception 'لم يُحدد سكنك بعد. راجعي الإدارة'; end if;
    if new.request_type = 'room_change' then
      new.destination_dormitory_id := new.source_dormitory_id;
    elsif new.destination_dormitory_id = new.source_dormitory_id then
      raise exception 'اختاري سكناً آخر غير سكنك الحالي';
    end if;
    select * into v_room from rooms where id = new.destination_room_id and is_active;
    if not found or v_room.dormitory_id is distinct from new.destination_dormitory_id then
      raise exception 'الغرفة المطلوبة غير صحيحة';
    end if;
    if new.destination_room_id = new.source_room_id then raise exception 'هذه غرفتك الحالية'; end if;
    select count(*) into v_used from profiles where room_id = v_room.id and role = 'student' and is_active;
    if v_used >= v_room.capacity then raise exception 'الغرفة المطلوبة ممتلئة'; end if;
  end if;

  if new.request_type in ('exit_permit','guardian_exit','hosting') then
    if new.start_at is null or new.end_at is null or new.end_at <= new.start_at then
      raise exception 'وقت النهاية يجب أن يكون بعد وقت البداية';
    end if;
  end if;

  if new.request_type = 'guardian_exit' then
    if coalesce(trim(new.details #>> '{companion,full_name}'), '') = '' then
      raise exception 'اكتبي اسم الشخص الذي ستخرجين معه';
    end if;
    select sakan_normalize_phone(guardian_phone) into new.guardian_phone from profiles where id = new.student_id;
    if new.guardian_phone is null then
      raise exception 'لا يوجد رقم هاتف لولي أمرك في ملفك. راجعي الإدارة لإضافته';
    end if;
    new.status := 'pending_guardian';
    new.guardian_status := 'pending';
    new.guardian_token := encode(extensions.gen_random_bytes(12), 'hex');
    new.guardian_message_id := null; new.guardian_sent_at := null; new.guardian_send_count := 0;
    new.guardian_replied_at := null; new.guardian_reply := null; new.guardian_channel := null; new.guardian_error := null;
  else
    new.guardian_status := null; new.guardian_token := null; new.guardian_phone := null;
  end if;

  if exists (select 1 from service_requests
             where student_id = new.student_id
               and (request_type = new.request_type
                    or (new.request_type in ('exit_permit','guardian_exit') and request_type in ('exit_permit','guardian_exit')))
               and status in ('pending_guardian','pending_supervisor','pending_admin')) then
    raise exception 'لديك طلب من نفس النوع قيد المراجعة';
  end if;
  return new;
end $$;

create or replace function public.sakan_apply_move(p_request_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  r service_requests;
  v_room rooms;
  v_used int;
begin
  select * into r from service_requests where id = p_request_id;
  select * into v_room from rooms where id = r.destination_room_id and is_active;
  if not found then raise exception 'الغرفة المطلوبة لم تعد متاحة'; end if;
  select count(*) into v_used from profiles
   where room_id = v_room.id and role = 'student' and is_active and id <> r.student_id;
  if v_used >= v_room.capacity then raise exception 'الغرفة المطلوبة ممتلئة الآن'; end if;
  update profiles set dormitory_id = v_room.dormitory_id, room_id = v_room.id where id = r.student_id;
end $$;

create or replace function public.sakan_decide_request(p_request_id uuid, p_decision text, p_note text default null)
returns text language plpgsql security definer set search_path = public
as $$
declare
  r service_requests;
  v_role text := sakan_user_role();
  v_uid uuid := auth.uid();
  v_new text;
begin
  if p_decision not in ('approved','rejected') then raise exception 'قرار غير صحيح'; end if;
  if p_decision = 'rejected' and coalesce(trim(p_note), '') = '' then raise exception 'يرجى كتابة سبب الرفض'; end if;

  select * into r from service_requests where id = p_request_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;

  if r.request_type = 'guardian_exit' then
    if p_decision = 'approved' and r.guardian_status is distinct from 'approved' then
      raise exception 'لا يمكن الاعتماد قبل موافقة ولي الأمر';
    end if;
    if r.status = 'pending_guardian' and p_decision = 'rejected' then
      update service_requests set status = 'pending_supervisor' where id = r.id;
      r.status := 'pending_supervisor';
    end if;
  end if;

  if v_role = 'supervisor' then
    if r.status <> 'pending_supervisor' then raise exception 'تمت معالجة هذا الطلب مسبقاً'; end if;
    if r.source_dormitory_id is distinct from sakan_user_dormitory() then raise exception 'هذا الطلب ليس من سكنك'; end if;
    if p_decision = 'rejected' then v_new := 'rejected';
    elsif r.request_type = 'dorm_transfer' then v_new := 'pending_admin';
    elsif r.request_type = 'room_change' then perform sakan_apply_move(r.id); v_new := 'completed';
    else v_new := 'approved';
    end if;
    update service_requests
       set status = v_new, supervisor_decision_by = v_uid, supervisor_decision_at = now(),
           decision_note = coalesce(nullif(trim(p_note), ''), decision_note)
     where id = r.id;

  elsif v_role = 'admin' then
    if r.status not in ('pending_supervisor','pending_admin') then raise exception 'تمت معالجة هذا الطلب مسبقاً'; end if;
    if p_decision = 'rejected' then v_new := 'rejected';
    elsif r.request_type in ('dorm_transfer','room_change') then perform sakan_apply_move(r.id); v_new := 'completed';
    else v_new := 'approved';
    end if;
    update service_requests
       set status = v_new, admin_decision_by = v_uid, admin_decision_at = now(),
           decision_note = coalesce(nullif(trim(p_note), ''), decision_note)
     where id = r.id;
  else
    raise exception 'ليست لديك صلاحية لهذا الإجراء';
  end if;

  insert into audit_logs (actor_id, action, entity_type, entity_id, details)
  values (v_uid, 'request_' || p_decision, 'service_request', r.id,
          jsonb_build_object('new_status', v_new, 'note', p_note, 'role', v_role));

  insert into notifications (user_id, title, message)
  values (r.student_id, 'تحديث على طلبك',
          case v_new
            when 'rejected' then 'تم رفض طلبك' || coalesce(': ' || nullif(trim(p_note), ''), '')
            when 'pending_admin' then 'وافقت المشرفة على طلب النقل، وهو الآن بانتظار الإدارة'
            when 'completed' then 'تم تنفيذ النقل وتحديث سكنك وغرفتك'
            else 'تمت الموافقة على طلبك'
          end);
  return v_new;
end $$;

create or replace function public.security_update_request(p_request_id uuid, p_action text, p_note text default null)
returns text language plpgsql security definer set search_path = public
as $$
declare r service_requests;
begin
  if sakan_user_role() <> 'security' then raise exception 'ليست لديك صلاحية لهذا الإجراء'; end if;
  select * into r from service_requests where id = p_request_id for update;
  if not found or r.request_type not in ('exit_permit','guardian_exit') or r.status <> 'approved' then
    raise exception 'التصريح غير معتمد';
  end if;

  if p_action = 'received' then
    if r.security_status <> 'not_received' then raise exception 'استُلمت البطاقة مسبقاً'; end if;
    update service_requests set security_status = 'received', security_received_by = auth.uid(),
           security_received_at = now(), security_note = coalesce(p_note, security_note) where id = r.id;
  elsif p_action = 'verified' then
    if r.security_status <> 'received' then raise exception 'استلمي البطاقة أولاً'; end if;
    update service_requests set security_status = 'verified', security_verified_by = auth.uid(),
           security_verified_at = now(), security_note = coalesce(p_note, security_note) where id = r.id;
  elsif p_action = 'mismatch' then
    update service_requests set security_status = 'mismatch', security_note = p_note where id = r.id;
  else
    raise exception 'إجراء غير صحيح';
  end if;

  insert into audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'security_' || p_action, 'service_request', r.id, jsonb_build_object('note', p_note));
  return p_action;
end $$;

create or replace function public.sakan_security_gate(p_request_id uuid, p_action text)
returns text language plpgsql security definer set search_path = public
as $$
declare r service_requests;
begin
  if sakan_user_role() <> 'security' then raise exception 'ليست لديك صلاحية لهذا الإجراء'; end if;
  select * into r from service_requests where id = p_request_id for update;
  if not found or r.status <> 'approved' then raise exception 'الطلب غير معتمد'; end if;

  if r.request_type in ('exit_permit','guardian_exit') then
    if p_action = 'out' then
      if r.security_status <> 'verified' then raise exception 'تحققي من البطاقة أولاً'; end if;
      if r.gate_out_at is not null then raise exception 'سُجّل الخروج مسبقاً'; end if;
      update service_requests set gate_out_at = now(), gate_by = auth.uid() where id = r.id;
    elsif p_action = 'in' then
      if r.gate_out_at is null then raise exception 'لم يُسجَّل خروج الطالبة'; end if;
      update service_requests set gate_in_at = now(), gate_by = auth.uid(), status = 'completed' where id = r.id;
    else raise exception 'إجراء غير صحيح'; end if;

  elsif r.request_type = 'hosting' then
    if p_action = 'in' then
      if r.gate_in_at is not null then raise exception 'سُجّل دخول الضيفة مسبقاً'; end if;
      update service_requests set gate_in_at = now(), gate_by = auth.uid() where id = r.id;
    elsif p_action = 'out' then
      if r.gate_in_at is null then raise exception 'لم يُسجَّل دخول الضيفة'; end if;
      update service_requests set gate_out_at = now(), gate_by = auth.uid(), status = 'completed' where id = r.id;
    else raise exception 'إجراء غير صحيح'; end if;
  else
    raise exception 'هذا الطلب لا يمر عبر البوابة';
  end if;

  insert into audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'gate_' || p_action, 'service_request', r.id, jsonb_build_object('type', r.request_type));
  return p_action;
end $$;

create or replace function public.update_my_identity_from_card(p_full_name text default null, p_civil_id text default null)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update profiles
     set civil_id = coalesce(civil_id, nullif(trim(p_civil_id), ''))
   where id = auth.uid() and role = 'student';
end $$;

create or replace function public.sakan_register_attendance()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_row attendance;
begin
  if sakan_user_role() <> 'student' then raise exception 'هذه الخدمة للطالبات فقط'; end if;
  insert into attendance (student_id, attendance_date, status, method, registered_at)
  values (auth.uid(), sakan_today(), 'registered', 'web', now())
  on conflict (student_id, attendance_date) do nothing;
  select * into v_row from attendance where student_id = auth.uid() and attendance_date = sakan_today();
  return to_jsonb(v_row);
end $$;

create or replace function public.sakan_record_fingerprint(p_fingerprint_id text, p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_student profiles;
  v_day date := (p_at at time zone 'Asia/Muscat')::date;
  v_row attendance;
begin
  if sakan_user_role() not in ('security','admin') then raise exception 'ليست لديك صلاحية لهذا الإجراء'; end if;

  select * into v_student from profiles where fingerprint_id = trim(p_fingerprint_id) and role = 'student';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown', 'message', 'رقم البصمة غير مسجّل لأي طالبة');
  end if;

  select * into v_row from attendance where student_id = v_student.id and attendance_date = v_day for update;
  if not found or v_row.registered_at is null or v_row.registered_at > p_at then
    return jsonb_build_object('ok', false, 'code', 'not_registered',
      'message', v_student.full_name || ': لم تسجّل حضورها في الموقع قبل البصمة');
  end if;
  if v_row.fingerprint_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already', 'message', v_student.full_name || ': البصمة مسجلة مسبقاً');
  end if;

  update attendance
     set fingerprint_at = p_at, status = 'present', method = 'web_fingerprint', recorded_by = auth.uid()
   where id = v_row.id;
  return jsonb_build_object('ok', true, 'code', 'confirmed', 'message', 'تم تأكيد حضور ' || v_student.full_name);
end $$;

create or replace function public.sakan_room_availability()
returns table (room_id uuid, dormitory_id uuid, dormitory_name text, room_number text, capacity int, occupied int)
language sql stable security definer set search_path = public
as $$
  select r.id, r.dormitory_id, d.name, r.room_number, r.capacity,
         (select count(*)::int from profiles p where p.room_id = r.id and p.role = 'student' and p.is_active)
  from rooms r join dormitories d on d.id = r.dormitory_id
  where r.is_active and d.is_active
  order by d.name, r.room_number
$$;

create or replace function public.sakan_save_my_card(p_kind text, p_path text, p_name text default null,
                                          p_civil text default null, p_request_id uuid default null)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if sakan_user_role() is distinct from 'student' then raise exception 'هذه الخدمة للطالبات فقط'; end if;
  if p_kind not in ('student','guardian') then raise exception 'نوع البطاقة غير صحيح'; end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> auth.uid()::text then raise exception 'مسار الصورة غير صحيح'; end if;

  insert into id_cards (student_id, kind, image_path, full_name, civil_id, request_id)
  values (auth.uid(), p_kind, p_path, nullif(trim(p_name), ''), nullif(trim(p_civil), ''), p_request_id);

  if p_kind = 'student' then
    update profiles set student_card_path = p_path,
           student_card_name = coalesce(nullif(trim(p_name), ''), student_card_name),
           student_card_civil = coalesce(nullif(trim(p_civil), ''), student_card_civil),
           civil_id = coalesce(civil_id, nullif(trim(p_civil), '')),
           cards_updated_at = now()
     where id = auth.uid();
  else
    update profiles set guardian_card_path = p_path,
           guardian_card_name = coalesce(nullif(trim(p_name), ''), guardian_card_name),
           guardian_card_civil = coalesce(nullif(trim(p_civil), ''), guardian_card_civil),
           cards_updated_at = now()
     where id = auth.uid();
  end if;
end $$;

create or replace function public.sakan_notify_dorm_supervisors(p_dorm uuid, p_title text, p_message text)
returns void language sql security definer set search_path = public
as $$
  insert into notifications (user_id, title, message)
  select id, p_title, p_message from profiles
   where role = 'supervisor' and is_active and dormitory_id = p_dorm
$$;

create or replace function public.sakan_guardian_prepare(p_request_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  r service_requests;
  v_actor profiles;
  v_student profiles;
begin
  select * into r from service_requests where id = p_request_id for update;
  if not found or r.request_type <> 'guardian_exit' then raise exception 'الطلب غير موجود'; end if;
  select * into v_actor from profiles where id = p_actor and is_active;
  if not found or not (v_actor.id = r.student_id or v_actor.role = 'admin'
                      or (v_actor.role = 'supervisor' and v_actor.dormitory_id = r.source_dormitory_id)) then
    raise exception 'ليست لديك صلاحية لهذا الإجراء';
  end if;
  if r.status <> 'pending_guardian' then raise exception 'الطلب لم يعد بانتظار رد ولي الأمر'; end if;
  if v_actor.id = r.student_id and r.guardian_send_count > 0 then raise exception 'أُرسلت الرسالة لولي الأمر مسبقاً'; end if;
  if r.guardian_send_count >= 5 then raise exception 'تجاوز عدد مرات الإرسال المسموح'; end if;

  update service_requests set guardian_send_count = guardian_send_count + 1 where id = r.id;
  select * into v_student from profiles where id = r.student_id;

  return jsonb_build_object(
    'phone', r.guardian_phone,
    'token', r.guardian_token,
    'guardian_name', coalesce(nullif(v_student.guardian_name, ''), 'ولي الأمر'),
    'student_name', v_student.full_name,
    'companion_name', r.details #>> '{companion,full_name}',
    'companion_relation', coalesce(nullif(r.details #>> '{companion,relationship}', ''), 'مرافق'),
    'start_at', r.start_at, 'end_at', r.end_at,
    'destination', coalesce(nullif(r.details ->> 'destination', ''), '—'));
end $$;

create or replace function public.sakan_guardian_mark_sent(p_request_id uuid, p_message_id text default null, p_error text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare r service_requests; v_name text;
begin
  update service_requests
     set guardian_status = case when p_error is null then 'sent' else 'failed' end,
         guardian_message_id = coalesce(p_message_id, guardian_message_id),
         guardian_sent_at = case when p_error is null then now() else guardian_sent_at end,
         guardian_error = p_error, guardian_channel = 'whatsapp'
   where id = p_request_id and status = 'pending_guardian'
  returning * into r;
  if found and p_error is not null then
    select full_name into v_name from profiles where id = r.student_id;
    perform sakan_notify_dorm_supervisors(r.source_dormitory_id, 'تعذّر إرسال واتساب',
      'لم تُرسل رسالة الموافقة تلقائياً لولي أمر الطالبة ' || v_name || '. أرسلي له رابط الموافقة على واتساب من لوحتك، أو اتصلي به وسجّلي رده.');
  end if;
end $$;

create or replace function public.sakan_guardian_mark_failed(p_message_id text, p_error text)
returns void language plpgsql security definer set search_path = public
as $$
declare r service_requests;
begin
  select * into r from service_requests where guardian_message_id = p_message_id and status = 'pending_guardian';
  if found then perform sakan_guardian_mark_sent(r.id, null, coalesce(p_error, 'لم تُسلَّم الرسالة')); end if;
end $$;

create or replace function public.sakan_guardian_apply(p_request_id uuid, p_answer text, p_channel text, p_text text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare r service_requests; v_name text; v_companion text; v_ar text;
begin
  if p_answer not in ('approved','rejected') then raise exception 'رد غير صحيح'; end if;
  update service_requests
     set guardian_status = p_answer, guardian_replied_at = now(), guardian_reply = left(p_text, 500),
         guardian_channel = p_channel, status = 'pending_supervisor'
   where id = p_request_id and status = 'pending_guardian'
  returning * into r;
  if not found then return jsonb_build_object('ok', false, 'code', 'closed'); end if;

  select full_name into v_name from profiles where id = r.student_id;
  v_companion := coalesce(r.details #>> '{companion,full_name}', '');
  v_ar := case p_answer when 'approved' then 'موافق' else 'غير موافق' end;

  perform sakan_notify_dorm_supervisors(r.source_dormitory_id, 'رد ولي الأمر: ' || v_ar,
    'ولي أمر الطالبة ' || v_name || ' ' || v_ar || ' على خروجها مع ' || v_companion || '. الطلب الآن بانتظار قرارك.');
  insert into notifications (user_id, title, message)
  values (r.student_id, 'رد ولي الأمر',
          case p_answer when 'approved' then 'وافق ولي أمرك على الخروج، والطلب الآن لدى المشرفة.'
                        else 'لم يوافق ولي أمرك على الخروج.' end);
  insert into audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'guardian_' || p_answer, 'service_request', r.id, jsonb_build_object('channel', p_channel, 'text', p_text));
  return jsonb_build_object('ok', true, 'answer', p_answer, 'student_name', v_name);
end $$;

create or replace function public.sakan_guardian_reply(p_token text, p_answer text, p_from text, p_text text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare r service_requests;
begin
  select * into r from service_requests where guardian_token = p_token;
  if not found then return jsonb_build_object('ok', false, 'code', 'unknown'); end if;
  if sakan_normalize_phone(p_from) is distinct from r.guardian_phone then
    return jsonb_build_object('ok', false, 'code', 'wrong_phone');
  end if;
  return sakan_guardian_apply(r.id, p_answer, 'whatsapp', p_text);
end $$;

create or replace function public.sakan_guardian_reply_by_phone(p_from text, p_answer text, p_text text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from service_requests
   where status = 'pending_guardian' and guardian_status = 'sent'
     and guardian_phone = sakan_normalize_phone(p_from)
   order by guardian_sent_at desc limit 1;
  if v_id is null then return jsonb_build_object('ok', false, 'code', 'none'); end if;
  return sakan_guardian_apply(v_id, p_answer, 'whatsapp', p_text);
end $$;

create or replace function public.sakan_guardian_manual(p_request_id uuid, p_answer text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare r service_requests; v_role text := sakan_user_role();
begin
  select * into r from service_requests where id = p_request_id;
  if not found or r.request_type <> 'guardian_exit' then raise exception 'الطلب غير موجود'; end if;
  if not (v_role = 'admin' or (v_role = 'supervisor' and r.source_dormitory_id = sakan_user_dormitory())) then
    raise exception 'ليست لديك صلاحية لهذا الإجراء';
  end if;
  if r.status <> 'pending_guardian' then raise exception 'الطلب لم يعد بانتظار رد ولي الأمر'; end if;
  return sakan_guardian_apply(r.id, p_answer, 'manual',
    'سجّلته ' || (select full_name from profiles where id = auth.uid()) || coalesce(': ' || nullif(trim(p_note), ''), ''));
end $$;

create or replace function public.sakan_guardian_client_failed(p_request_id uuid, p_error text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare r service_requests;
begin
  select * into r from service_requests where id = p_request_id;
  if not found or r.student_id is distinct from auth.uid() then raise exception 'الطلب غير موجود'; end if;
  if r.status = 'pending_guardian' and r.guardian_status = 'pending' then
    perform sakan_guardian_mark_sent(r.id, null, coalesce(nullif(left(p_error, 300), ''), 'خدمة واتساب التلقائية غير مفعّلة'));
  end if;
end $$;

create or replace function public.sakan_guardian_link(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare r service_requests; v_role text := sakan_user_role(); v_token text; v_student profiles;
begin
  select * into r from service_requests where id = p_request_id for update;
  if not found or r.request_type <> 'guardian_exit' then raise exception 'الطلب غير موجود'; end if;
  if not (v_role = 'admin' or (v_role = 'supervisor' and r.source_dormitory_id = sakan_user_dormitory())) then
    raise exception 'ليست لديك صلاحية لهذا الإجراء';
  end if;
  if r.status <> 'pending_guardian' then raise exception 'الطلب لم يعد بانتظار رد ولي الأمر'; end if;

  select token into v_token from guardian_links where request_id = r.id;
  if v_token is null then
    v_token := encode(extensions.gen_random_bytes(16), 'hex');
    insert into guardian_links (request_id, token, created_by) values (r.id, v_token, auth.uid());
  end if;

  update service_requests
     set guardian_status = 'sent', guardian_channel = 'link', guardian_sent_at = now(),
         guardian_send_count = guardian_send_count + 1, guardian_error = null
   where id = r.id;
  select * into v_student from profiles where id = r.student_id;

  return jsonb_build_object(
    'token', v_token, 'phone', r.guardian_phone,
    'guardian_name', coalesce(nullif(v_student.guardian_name, ''), 'ولي الأمر'),
    'student_name', v_student.full_name,
    'companion_name', r.details #>> '{companion,full_name}',
    'companion_relation', coalesce(nullif(r.details #>> '{companion,relationship}', ''), 'مرافق'),
    'start_at', r.start_at, 'end_at', r.end_at,
    'destination', coalesce(nullif(r.details ->> 'destination', ''), '—'));
end $$;

create or replace function public.sakan_guardian_web_view(p_token text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare l guardian_links; r service_requests; v_student profiles; v_dorm text;
begin
  select * into l from guardian_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'code', 'unknown'); end if;
  select * into r from service_requests where id = l.request_id;
  select * into v_student from profiles where id = r.student_id;
  select name into v_dorm from dormitories where id = r.source_dormitory_id;
  update guardian_links set opened_at = coalesce(opened_at, now()) where request_id = l.request_id;
  return jsonb_build_object(
    'ok', true,
    'state', case when r.status = 'pending_guardian' then 'pending'
                  when r.guardian_status in ('approved','rejected') then r.guardian_status
                  else 'closed' end,
    'guardian_name', coalesce(nullif(v_student.guardian_name, ''), 'ولي الأمر'),
    'student_name', v_student.full_name, 'dormitory', v_dorm,
    'companion_name', r.details #>> '{companion,full_name}',
    'companion_relation', r.details #>> '{companion,relationship}',
    'start_at', r.start_at, 'end_at', r.end_at,
    'destination', r.details ->> 'destination');
end $$;

create or replace function public.sakan_guardian_web_reply(p_token text, p_answer text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare l guardian_links;
begin
  if p_answer not in ('approved','rejected') then raise exception 'رد غير صحيح'; end if;
  select * into l from guardian_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'code', 'unknown'); end if;
  return sakan_guardian_apply(l.request_id, p_answer, 'link',
    case p_answer when 'approved' then 'موافق (عبر الرابط)' else 'غير موافق (عبر الرابط)' end);
end $$;

-- 6. صلاحيات الدوال
revoke all on function public.sakan_create_account_internal(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.sakan_admin_create_account(text, text, text, jsonb) to authenticated;
grant execute on function public.sakan_admin_set_password(uuid, text) to authenticated;
grant execute on function public.sakan_admin_delete_account(uuid) to authenticated;
revoke all on function public.sakan_apply_move(uuid) from public, anon, authenticated;
grant execute on function public.sakan_decide_request(uuid, text, text) to authenticated;
grant execute on function public.security_update_request(uuid, text, text) to authenticated;
grant execute on function public.sakan_security_gate(uuid, text) to authenticated;
grant execute on function public.update_my_identity_from_card(text, text) to authenticated;
grant execute on function public.sakan_register_attendance() to authenticated;
grant execute on function public.sakan_record_fingerprint(text, timestamptz) to authenticated;
grant execute on function public.sakan_room_availability() to authenticated;
grant execute on function public.sakan_save_my_card(text, text, text, text, uuid) to authenticated;
revoke all on function public.sakan_notify_dorm_supervisors(uuid, text, text) from public, anon, authenticated;
revoke all on function public.sakan_guardian_prepare(uuid, uuid) from public, anon, authenticated;
revoke all on function public.sakan_guardian_mark_sent(uuid, text, text) from public, anon, authenticated;
revoke all on function public.sakan_guardian_mark_failed(text, text) from public, anon, authenticated;
revoke all on function public.sakan_guardian_apply(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.sakan_guardian_reply(text, text, text, text) from public, anon, authenticated;
revoke all on function public.sakan_guardian_reply_by_phone(text, text, text) from public, anon, authenticated;
grant execute on function public.sakan_guardian_manual(uuid, text, text) to authenticated;
grant execute on function public.sakan_guardian_client_failed(uuid, text) to authenticated;
grant execute on function public.sakan_guardian_link(uuid) to authenticated;
grant execute on function public.sakan_guardian_web_view(text) to anon, authenticated;
grant execute on function public.sakan_guardian_web_reply(text, text) to anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.sakan_guardian_prepare(uuid, uuid) to service_role;
    grant execute on function public.sakan_guardian_mark_sent(uuid, text, text) to service_role;
    grant execute on function public.sakan_guardian_mark_failed(text, text) to service_role;
    grant execute on function public.sakan_guardian_reply(text, text, text, text) to service_role;
    grant execute on function public.sakan_guardian_reply_by_phone(text, text, text) to service_role;
  end if;
end $$;

-- 7. سياسات الوصول (RLS)
drop policy if exists "Users view active dormitories" on public.dormitories;
create policy "Users view active dormitories" on public.dormitories for select to authenticated
  using (is_active);

drop policy if exists "Admins manage dormitories" on public.dormitories;
create policy "Admins manage dormitories" on public.dormitories for all to authenticated
  using (sakan_user_role() = 'admin') with check (sakan_user_role() = 'admin');

drop policy if exists "Users view active rooms" on public.rooms;
create policy "Users view active rooms" on public.rooms for select to authenticated
  using (is_active);

drop policy if exists "Admins manage rooms" on public.rooms;
create policy "Admins manage rooms" on public.rooms for all to authenticated
  using (sakan_user_role() = 'admin') with check (sakan_user_role() = 'admin');

drop policy if exists "Scoped profile read" on public.profiles;
create policy "Scoped profile read" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or sakan_user_role() = 'admin'
    or (sakan_user_role() = 'supervisor' and dormitory_id = sakan_user_dormitory())
    or (sakan_user_role() = 'security' and exists (
          select 1 from service_requests sr
           where sr.student_id = profiles.id
             and sr.request_type in ('exit_permit','guardian_exit','hosting')
             and sr.status in ('approved','completed')))
  );

drop policy if exists "Admins update profiles" on public.profiles;
create policy "Admins update profiles" on public.profiles for update to authenticated
  using (sakan_user_role() = 'admin') with check (sakan_user_role() = 'admin');

drop policy if exists "Admins delete profiles" on public.profiles;
create policy "Admins delete profiles" on public.profiles for delete to authenticated
  using (sakan_user_role() = 'admin');

drop policy if exists "Scoped request read" on public.service_requests;
create policy "Scoped request read" on public.service_requests for select to authenticated
  using (
    student_id = auth.uid()
    or sakan_user_role() = 'admin'
    or (sakan_user_role() = 'supervisor'
        and (source_dormitory_id = sakan_user_dormitory() or destination_dormitory_id = sakan_user_dormitory()))
    or (sakan_user_role() = 'security'
        and request_type in ('exit_permit','guardian_exit','hosting') and status in ('approved','completed'))
  );

drop policy if exists "Students submit requests" on public.service_requests;
create policy "Students submit requests" on public.service_requests for insert to authenticated
  with check (
    student_id = auth.uid() and sakan_user_role() = 'student'
    and status in ('pending_supervisor','pending_guardian')
    and supervisor_decision_by is null and admin_decision_by is null
    and coalesce(security_status, 'not_received') = 'not_received'
    and gate_out_at is null and gate_in_at is null
  );

drop policy if exists "Scoped attendance read" on public.attendance;
create policy "Scoped attendance read" on public.attendance for select to authenticated
  using (
    student_id = auth.uid()
    or sakan_user_role() = 'admin'
    or (sakan_user_role() = 'supervisor' and exists (
          select 1 from profiles p where p.id = attendance.student_id and p.dormitory_id = sakan_user_dormitory()))
  );

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications" on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users mark own notifications read" on public.notifications;
create policy "Users mark own notifications read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Scoped id card archive read" on public.id_cards;
create policy "Scoped id card archive read" on public.id_cards for select to authenticated
  using (
    student_id = auth.uid()
    or sakan_user_role() = 'admin'
    or (sakan_user_role() = 'supervisor' and exists (
          select 1 from profiles p where p.id = id_cards.student_id and p.dormitory_id = sakan_user_dormitory()))
  );

drop policy if exists "Admins read audit logs" on public.audit_logs;
create policy "Admins read audit logs" on public.audit_logs for select to authenticated
  using (sakan_user_role() = 'admin');

drop policy if exists "Students upload own id cards" on storage.objects;
create policy "Students upload own id cards" on storage.objects for insert to authenticated
  with check (bucket_id = 'id-cards'
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.sakan_user_role() = 'student');

drop policy if exists "Scoped id card read" on storage.objects;
create policy "Scoped id card read" on storage.objects for select to authenticated
  using (bucket_id = 'id-cards' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.sakan_user_role() = 'admin'
    or (public.sakan_user_role() = 'supervisor' and exists (
          select 1 from public.profiles p
           where p.id::text = (storage.foldername(name))[1]
             and p.dormitory_id = public.sakan_user_dormitory()))
    or (public.sakan_user_role() = 'security' and exists (
          select 1 from public.service_requests sr
           where sr.student_id::text = (storage.foldername(name))[1]
             and sr.request_type in ('exit_permit','guardian_exit')
             and sr.status in ('approved','completed')))
  ));

-- 8. تحديث ذاكرة واجهة البيانات
notify pgrst, 'reload schema';

select 'تم تحديث قاعدة البيانات بنجاح' as result;
