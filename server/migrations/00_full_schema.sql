-- Full schema for the new Supabase project, reverse-engineered from application code
-- (server/routes/*.js, server/utils/*.js, server/migrations/*) since no canonical
-- schema file existed for the old project. Run this once, in full, in the
-- Supabase SQL Editor for the NEW project (artoqeocaqpwvpicthzr), or applied
-- with: node server/apply_schema.js

create extension if not exists pgcrypto;

-- =========================================================
-- users
-- =========================================================
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'booker', -- admin | booker | viewer
  leads_assigned integer default 0,
  bookings_made integer default 0,
  show_ups integer default 0,
  is_active boolean default true,
  last_active_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =========================================================
-- leads
-- =========================================================
create table leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text,
  email text,
  postcode text,
  age integer,
  image_url text,
  parent_phone text,
  booker_id uuid references users(id) on delete set null,
  created_by_user_id uuid references users(id) on delete set null,
  updated_by_user_id uuid references users(id) on delete set null,
  booked_by uuid references users(id) on delete set null,
  status text default 'New', -- New | Assigned | Booked | Attended | Cancelled | Rejected | No Show | Wrong Number | No Answer
  date_booked timestamptz,
  is_confirmed boolean default false,
  has_sale boolean default false,
  booking_status text, -- e.g. 'Reschedule'
  booking_history text, -- JSON.stringify'd array of history entries
  notes text,
  tags text, -- JSON.stringify'd array
  booked_at timestamptz,
  ever_booked boolean default false,
  assigned_at timestamptz,
  deleted_at timestamptz,
  reject_reason text,
  rejected_at timestamptz,
  booking_account text,
  model_stats jsonb,
  retargeting jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_leads_ever_booked on leads(ever_booked) where ever_booked = true;
create index idx_leads_booked_at on leads(booked_at) where booked_at is not null;
create index idx_leads_status_wrong_number on leads(status) where status = 'Wrong Number';
create index idx_leads_booker_id on leads(booker_id);
create index idx_leads_status on leads(status);

-- =========================================================
-- templates
-- =========================================================
create table templates (
  id text primary key,
  name text not null,
  type text not null, -- booking_confirmation | appointment_reminder | wrong_number | no_answer | sale_notification | sale_receipt | sms | email | retargeting_gentle | retargeting_urgent | retargeting_final
  subject text,
  email_body text,
  sms_body text,
  content text,
  category text,
  is_active boolean default true,
  is_default boolean default false,
  user_id uuid references users(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  send_email boolean default true,
  send_sms boolean default false,
  reminder_days integer default 5,
  reminder_time varchar(5) default '09:00',
  email_account varchar(50) default 'primary',
  sender_name text,
  attachments text, -- JSON.stringify'd array
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_templates_user_id on templates(user_id);
create index idx_templates_email_account on templates(email_account);

-- =========================================================
-- messages
-- =========================================================
create table messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  template_id text references templates(id) on delete set null,
  type text, -- sms | email | both
  content text,
  sms_body text,
  email_body text,
  subject text,
  recipient_email text,
  recipient_phone text,
  sent_by uuid references users(id) on delete set null,
  sent_by_name text,
  status text, -- pending | sent | failed | delivered
  email_status text, -- pending | sent | failed
  sms_status text,
  read_status boolean default false,
  delivery_status text,
  delivery_provider text,
  delivery_attempts integer,
  provider_message_id text,
  error_message text,
  attachments jsonb,
  gmail_message_id text,
  gmail_account_key text,
  sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint unique_gmail_message_per_lead unique (gmail_message_id, lead_id)
);

create index idx_messages_lead_id on messages(lead_id);
create index idx_messages_gmail_message_id on messages(gmail_message_id) where gmail_message_id is not null;

-- =========================================================
-- booking_history (standalone audit table; separate from leads.booking_history column)
-- =========================================================
create table booking_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  action text,
  performed_by uuid references users(id) on delete set null,
  performed_by_name text,
  details text,
  lead_snapshot text,
  created_at timestamptz default now()
);

create index idx_booking_history_lead_id on booking_history(lead_id);

-- =========================================================
-- booker_activity_log
-- =========================================================
create table booker_activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  activity_type text,
  old_value text,
  new_value text,
  activity_details jsonb default '{}',
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);

create index idx_booker_activity_log_user_id on booker_activity_log(user_id);
create index idx_booker_activity_log_created_at on booker_activity_log(created_at);

-- =========================================================
-- sales (finance_agreement_id FK added after `finance` table exists, below)
-- =========================================================
create table sales (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  amount numeric,
  payment_method text,
  payment_type text, -- full_payment | finance | deposit
  payment_status text, -- Pending | Paid | Partial
  status text default 'Pending', -- Pending | Completed
  notes text,
  finance_total_amount numeric,
  finance_deposit_amount numeric,
  finance_monthly_amount numeric,
  finance_term_months integer,
  finance_interest_rate numeric,
  finance_start_date date,
  finance_agreement_id uuid,
  deposit_amount numeric,
  deposit_paid boolean,
  remaining_balance numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_sales_lead_id on sales(lead_id);
create index idx_sales_user_id on sales(user_id);

-- =========================================================
-- finance
-- =========================================================
create table finance (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete set null,
  sale_id uuid references sales(id) on delete set null,
  sales_agent uuid references users(id) on delete set null,
  total_amount numeric,
  deposit_amount numeric default 0,
  monthly_payment numeric,
  payment_frequency text, -- weekly | bi-weekly | monthly | quarterly | bi-monthly
  term_months integer,
  interest_rate numeric default 0,
  start_date date,
  next_payment_date date,
  status text default 'active', -- active | completed | defaulted
  agreement_number text,
  total_paid numeric default 0,
  remaining_balance numeric,
  notes text,
  amount numeric,
  due_date date,
  payment_status text default 'Pending',
  email_reminders boolean default true,
  sms_reminders boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_finance_lead_id on finance(lead_id);

alter table sales
  add constraint sales_finance_agreement_id_fkey
  foreign key (finance_agreement_id) references finance(id) on delete set null;

-- =========================================================
-- finance_payments
-- =========================================================
create table finance_payments (
  id uuid primary key default gen_random_uuid(),
  finance_id uuid references finance(id) on delete cascade,
  payment_number integer,
  due_date date,
  amount_due numeric,
  amount_paid numeric,
  payment_date date,
  payment_method text,
  status text default 'pending', -- pending | paid
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_finance_payments_finance_id on finance_payments(finance_id);

-- =========================================================
-- finance_reminders
-- =========================================================
create table finance_reminders (
  id uuid primary key default gen_random_uuid(),
  finance_id uuid references finance(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  reminder_type text, -- email | sms
  reminder_date timestamptz,
  next_reminder_date timestamptz,
  status text, -- sent
  sent_at timestamptz,
  created_at timestamptz default now()
);

create index idx_finance_reminders_finance_id on finance_reminders(finance_id);

-- =========================================================
-- gmail_accounts
-- =========================================================
create table gmail_accounts (
  email text primary key,
  access_token text not null,
  refresh_token text not null,
  expiry_date bigint,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =========================================================
-- processed_gmail_messages
-- =========================================================
create table processed_gmail_messages (
  id uuid primary key default gen_random_uuid(),
  account_key text not null default 'primary',
  gmail_message_id text not null,
  processed_at timestamptz default now(),
  unique(account_key, gmail_message_id)
);

create index idx_processed_gmail_lookup on processed_gmail_messages(account_key, gmail_message_id);

-- =========================================================
-- legacy_leads
-- =========================================================
create table legacy_leads (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  phone text,
  postcode text,
  age integer,
  image_url text,
  has_image boolean default false,
  import_status text default 'imported',
  import_timestamp timestamptz default now(),
  data_quality_score numeric
);

-- =========================================================
-- legacy_import_sessions
-- =========================================================
create table legacy_import_sessions (
  id uuid primary key default gen_random_uuid(),
  start_time timestamptz default now(),
  end_time timestamptz,
  total_records integer,
  imported_records integer,
  failed_records integer,
  notes text
);

-- =========================================================
-- short_links
-- =========================================================
create table short_links (
  id text primary key,
  content text,
  created_at timestamptz default now()
);
