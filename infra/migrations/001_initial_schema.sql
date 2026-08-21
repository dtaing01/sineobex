-- Sineobex initial schema.
--
-- Run against the Aurora PostgreSQL cluster as the master user. PostGIS is
-- available as an Aurora extension and must be created before any table
-- declares a geography column.

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Organisations and people
-- ---------------------------------------------------------------------------

CREATE TABLE agencies (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id    uuid NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Membership is authoritative in Cognito; this mirrors it so the database can
-- enforce "you may only see your own team's caseload" in a join rather than
-- trusting the application to remember.
CREATE TABLE team_members (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  cognito_sub  text NOT NULL,
  display_name text NOT NULL,
  role         text NOT NULL,
  access_tier  text NOT NULL
                 CHECK (access_tier IN ('full-admin', 'standard', 'view-only')),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, cognito_sub)
);

CREATE INDEX team_members_sub_idx ON team_members (cognito_sub) WHERE active;

-- ---------------------------------------------------------------------------
-- Patients
-- ---------------------------------------------------------------------------

CREATE TABLE patients (
  id              uuid PRIMARY KEY,
  team_id         uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  dob             date NOT NULL,
  risk            text NOT NULL CHECK (risk IN ('Low', 'Moderate', 'High')),
  location_label  text NOT NULL,
  -- geography, not geometry: distances come out in metres without the caller
  -- having to pick a projection, and Detroit is not near the equator.
  location        geography(Point, 4326),
  tags            jsonb NOT NULL DEFAULT '[]'::jsonb,
  flags           jsonb NOT NULL DEFAULT '[]'::jsonb,
  follow_up       boolean NOT NULL DEFAULT false,
  next_follow_up  date,
  phone           text,
  insurance_name  text,
  member_id       text,
  primary_doctor  text,
  deleted         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Server clock. Authoritative, trigger-maintained, and the only column the
  -- sync cursor pages on — a device with a skewed clock must not be able to
  -- make its own writes invisible to the next page.
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Device clock at the moment of the edit. Used *only* to resolve
  -- last-writer-wins between two offline edits. Kept separate from
  -- updated_at because comparing a device clock against server now() means
  -- the incoming row is always "newer", which silently defeats the guard.
  client_updated_at timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_by      text
);

CREATE INDEX patients_team_idx ON patients (team_id) WHERE NOT deleted;
CREATE INDEX patients_updated_idx ON patients (updated_at);
CREATE INDEX patients_location_idx ON patients USING gist (location);
CREATE INDEX patients_followup_idx ON patients (next_follow_up)
  WHERE follow_up AND NOT deleted;
-- Name search without a trigram extension: the app searches on name or DOB.
CREATE INDEX patients_name_idx ON patients (lower(first_name), lower(last_name));

-- Where a patient is regularly found. Feeds the field-intelligence map.
CREATE TABLE patient_locations (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id   uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name         text NOT NULL,
  location     geography(Point, 4326) NOT NULL,
  observed_at  timestamptz NOT NULL,
  verified     boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patient_locations_patient_idx
  ON patient_locations (patient_id, observed_at DESC);
CREATE INDEX patient_locations_geo_idx
  ON patient_locations USING gist (location);

-- ---------------------------------------------------------------------------
-- Encounters
-- ---------------------------------------------------------------------------

-- Append-only by design: there is no UPDATE path, and the sync handler uses
-- ON CONFLICT DO NOTHING. A clinical note, once written, is a record.
-- Corrections are made by writing a later encounter, not by editing an
-- earlier one.
CREATE TABLE encounters (
  id                 uuid PRIMARY KEY,
  patient_id         uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  occurred_at        timestamptz NOT NULL,
  provider_sub       text NOT NULL,
  provider_name      text NOT NULL,
  needs              text NOT NULL DEFAULT '',
  location_label     text NOT NULL DEFAULT '',
  location           geography(Point, 4326),
  notes              text NOT NULL DEFAULT '',
  supplies           jsonb NOT NULL DEFAULT '[]'::jsonb,
  follow_up_set      boolean NOT NULL DEFAULT false,
  follow_up_date     date,
  follow_up_location text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX encounters_patient_idx
  ON encounters (patient_id, occurred_at DESC);
CREATE INDEX encounters_occurred_idx ON encounters (occurred_at);
CREATE INDEX encounters_location_idx ON encounters USING gist (location);
CREATE INDEX encounters_supplies_idx ON encounters USING gin (supplies);

CREATE RULE encounters_no_update AS
  ON UPDATE TO encounters DO INSTEAD NOTHING;
CREATE RULE encounters_no_delete AS
  ON DELETE TO encounters DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------

CREATE TABLE inventory_items (
  id          uuid PRIMARY KEY,
  team_id     uuid REFERENCES teams(id) ON DELETE CASCADE,
  name        text NOT NULL,
  category    text NOT NULL
                CHECK (category IN ('Medical', 'Essentials', 'Clothing')),
  stock       integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_level   integer NOT NULL DEFAULT 0 CHECK (min_level >= 0),
  unit        text NOT NULL,
  ordered_at  timestamptz,
  ordered_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  client_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, name)
);

CREATE INDEX inventory_low_idx ON inventory_items (team_id)
  WHERE stock < min_level;

CREATE TABLE supply_usage_log (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id      uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  item_name    text NOT NULL,
  quantity     text NOT NULL DEFAULT '1',
  location     text NOT NULL DEFAULT '',
  encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX supply_usage_time_idx ON supply_usage_log (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Reference data (server-owned; the device only reads it)
-- ---------------------------------------------------------------------------

CREATE TABLE resources (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  type       text NOT NULL CHECK (type IN (
               'Shelter', 'Hospital', 'Soup Kitchen',
               'Pharmacy', 'Dental', 'Restroom')),
  address    text NOT NULL DEFAULT '',
  location   geography(Point, 4326) NOT NULL,
  hours      text NOT NULL DEFAULT '',
  phone      text NOT NULL DEFAULT 'N/A',
  active     boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resources_geo_idx ON resources USING gist (location);
CREATE INDEX resources_type_idx ON resources (type) WHERE active;

CREATE TABLE hotspots (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  type          text NOT NULL,
  intensity     text NOT NULL CHECK (intensity IN ('Low', 'Moderate', 'High')),
  patient_count integer NOT NULL DEFAULT 0,
  location      geography(Point, 4326) NOT NULL,
  supply        text,
  -- Distinguishes clusters the cron job derived from ones a coordinator
  -- entered by hand, so recomputation never clobbers human knowledge.
  computed      boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hotspots_geo_idx ON hotspots USING gist (location);
CREATE INDEX hotspots_type_idx ON hotspots (type);

CREATE TABLE seasonal_demand (
  month       text PRIMARY KEY,
  items       text[] NOT NULL DEFAULT '{}',
  intensity   integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analytics_rollups (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  payload     jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analytics_rollups_lookup_idx
  ON analytics_rollups (name, computed_at DESC);

CREATE TABLE team_tasks (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  text       text NOT NULL,
  status     text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'completed')),
  priority   text NOT NULL DEFAULT 'Low'
               CHECK (priority IN ('Low', 'Moderate', 'High')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outreach_actions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  action_date date NOT NULL DEFAULT current_date,
  time_label  text NOT NULL,
  location    text NOT NULL,
  goal        text NOT NULL
);

CREATE INDEX outreach_actions_day_idx ON outreach_actions (team_id, action_date);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

-- Deliberately carries a subject id and nothing else. Push notifications
-- render on lock screens; "Follow-up due: Jane Smith, prenatal" on a lock
-- screen in a shared van is a disclosure. The app resolves the id to a name
-- only after the device is unlocked.
CREATE TABLE notification_queue (
  id             bigserial PRIMARY KEY,
  recipient_sub  text NOT NULL,
  kind           text NOT NULL,
  subject_id     text NOT NULL,
  scheduled_for  timestamptz NOT NULL DEFAULT now(),
  delivered_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_pending_idx ON notification_queue (scheduled_for)
  WHERE delivered_at IS NULL;

-- ---------------------------------------------------------------------------
-- Audit trail — HIPAA §164.312(b)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id               bigserial PRIMARY KEY,
  actor            text NOT NULL,
  action           text NOT NULL,
  entity           text NOT NULL,
  entity_id        text NOT NULL DEFAULT '',
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  source_ip        inet,
  -- True when the action happened on a device with no connectivity and was
  -- shipped later. The occurred_at is then the device's clock, not the
  -- server's, which matters when reconstructing a timeline.
  recorded_offline boolean NOT NULL DEFAULT false,
  archived         boolean NOT NULL DEFAULT false
);

CREATE INDEX audit_log_actor_idx ON audit_log (actor, occurred_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id, occurred_at DESC);
CREATE INDEX audit_log_unarchived_idx ON audit_log (occurred_at)
  WHERE NOT archived;

-- The audit log is evidence. Nothing may rewrite or remove a row; the
-- archival job only sets `archived`, which the rule below permits.
CREATE RULE audit_log_no_delete AS
  ON DELETE TO audit_log DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Attributes writes to the caller without every query having to pass an
-- actor. The API sets `sineobex.actor` per transaction via set_config().
CREATE OR REPLACE FUNCTION set_row_actor() RETURNS trigger AS $$
BEGIN
  -- Always the server clock: this drives the sync cursor.
  NEW.updated_at := now();
  NEW.updated_by := coalesce(
    nullif(current_setting('sineobex.actor', true), ''), 'system');
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := NEW.updated_by;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER patients_set_actor
  BEFORE INSERT OR UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION set_row_actor();

-- Records every change to a patient row, independently of whether the
-- application remembered to. An audit trail the application can forget to
-- write is not an audit trail.
CREATE OR REPLACE FUNCTION audit_patient_change() RETURNS trigger AS $$
BEGIN
  INSERT INTO audit_log (actor, action, entity, entity_id)
  VALUES (
    coalesce(nullif(current_setting('sineobex.actor', true), ''), 'system'),
    lower(TG_OP),
    'patient',
    coalesce(NEW.id::text, OLD.id::text)
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER patients_audit
  AFTER INSERT OR UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION audit_patient_change();

CREATE OR REPLACE FUNCTION audit_encounter_change() RETURNS trigger AS $$
BEGIN
  INSERT INTO audit_log (actor, action, entity, entity_id)
  VALUES (NEW.provider_sub, 'insert', 'encounter', NEW.id::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER encounters_audit
  AFTER INSERT ON encounters
  FOR EACH ROW EXECUTE FUNCTION audit_encounter_change();

-- Keeps the movement-pattern table in step with encounters, so the field map
-- learns from every documented visit without a second write from the client.
CREATE OR REPLACE FUNCTION record_encounter_location() RETURNS trigger AS $$
BEGIN
  IF NEW.location IS NOT NULL AND NEW.location_label <> '' THEN
    INSERT INTO patient_locations (patient_id, name, location, observed_at)
    VALUES (NEW.patient_id, NEW.location_label, NEW.location, NEW.occurred_at);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER encounters_record_location
  AFTER INSERT ON encounters
  FOR EACH ROW EXECUTE FUNCTION record_encounter_location();

COMMIT;
