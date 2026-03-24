-- ============================================================
-- MIGRAZIONE SUPABASE — Atinedis GDO CRM
-- Esegui questo script nel SQL Editor di Supabase
-- ATTENZIONE: elimina le tabelle precedenti (deals, tasks, ecc.)
-- ============================================================

-- 1. Drop tabelle vecchie (se presenti)
DROP TABLE IF EXISTS activity_log CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS deals CASCADE;

-- 2. Drop tabelle nuove (se già esistono, per idempotenza)
DROP TABLE IF EXISTS outreach_log CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;

-- 3. Tabella contacts (GDO)
CREATE TABLE contacts (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name      text NOT NULL,
  last_name       text,
  azienda         text,
  ruolo_categoria text,   -- CEO/DG/Presidente, Marketing/Comunicazione, IT/ICT, Marketing/Digital, Altro
  titolo          text,   -- titolo completo LinkedIn
  score           integer DEFAULT 1 CHECK (score IN (1, 2, 3)),
  email           text,
  email2          text,
  phone           text,
  phone2          text,
  linkedin_url    text,
  location        text,
  connection_degree text,
  stato_outreach  text DEFAULT 'Da contattare',
  note            text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- 4. Tabella outreach_log
CREATE TABLE outreach_log (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id  uuid REFERENCES contacts(id) ON DELETE CASCADE,
  tipo        text,   -- Email, LinkedIn, Telefono, Meeting, Demo, Altro
  data        date DEFAULT CURRENT_DATE,
  note        text,
  created_by  text,
  created_at  timestamptz DEFAULT now()
);

-- 5. Indici per performance
CREATE INDEX idx_contacts_azienda       ON contacts(azienda);
CREATE INDEX idx_contacts_score         ON contacts(score DESC);
CREATE INDEX idx_contacts_stato         ON contacts(stato_outreach);
CREATE INDEX idx_contacts_ruolo         ON contacts(ruolo_categoria);
CREATE INDEX idx_contacts_linkedin      ON contacts(linkedin_url);
CREATE INDEX idx_outreach_contact       ON outreach_log(contact_id);
CREATE INDEX idx_outreach_data          ON outreach_log(data DESC);

-- 6. Row Level Security (RLS)
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_log ENABLE ROW LEVEL SECURITY;

-- Policy: solo utenti autenticati possono accedere
CREATE POLICY "Authenticated users can read contacts"
  ON contacts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert contacts"
  ON contacts FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update contacts"
  ON contacts FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete contacts"
  ON contacts FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read logs"
  ON outreach_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert logs"
  ON outreach_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can delete logs"
  ON outreach_log FOR DELETE TO authenticated USING (true);

-- 7. Trigger per updated_at automatico
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- FATTO! Ora puoi importare i contatti tramite CSV dal CRM
-- oppure eseguire export_excel_to_csv.py per preparare il CSV
-- ============================================================
