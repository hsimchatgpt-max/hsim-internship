-- HSIM Intern Portal — initial schema

CREATE TABLE admins (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admins_email_key ON admins (lower(email));

CREATE TABLE interns (
  id                         BIGSERIAL PRIMARY KEY,
  hsim_id                    TEXT NOT NULL,
  full_name                  TEXT NOT NULL,
  phone                      TEXT NOT NULL,
  email                      TEXT NOT NULL,
  department                 TEXT NOT NULL CHECK (department IN ('SEO', 'Social Media')),
  batch                      TEXT NOT NULL,
  joining_date               DATE NOT NULL,
  internship_duration_months INTEGER NOT NULL CHECK (internship_duration_months BETWEEN 1 AND 36),
  end_date                   DATE NOT NULL,
  trainer                    TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Completed', 'Left')),
  notes                      TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= joining_date)
);
CREATE UNIQUE INDEX interns_hsim_id_key ON interns (upper(hsim_id));
CREATE INDEX interns_status_idx ON interns (status);
CREATE INDEX interns_department_idx ON interns (department);
CREATE INDEX interns_batch_idx ON interns (batch);
CREATE INDEX interns_end_date_idx ON interns (end_date);

CREATE TABLE leaves (
  id         BIGSERIAL PRIMARY KEY,
  intern_id  BIGINT NOT NULL REFERENCES interns (id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  reason     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX leaves_intern_idx ON leaves (intern_id, start_date);
CREATE INDEX leaves_status_idx ON leaves (status);

CREATE TABLE attendance (
  id              BIGSERIAL PRIMARY KEY,
  intern_id       BIGINT NOT NULL REFERENCES interns (id) ON DELETE RESTRICT,
  attendance_date DATE NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('Present', 'Absent', 'Leave', 'Half Day')),
  notes           TEXT,
  -- set when the row was created by approving a leave, so it can be reverted cleanly
  leave_id        BIGINT REFERENCES leaves (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attendance_intern_date_key UNIQUE (intern_id, attendance_date)
);
CREATE INDEX attendance_date_idx ON attendance (attendance_date);

CREATE TABLE tasks (
  id            BIGSERIAL PRIMARY KEY,
  intern_id     BIGINT NOT NULL REFERENCES interns (id) ON DELETE RESTRICT,
  title         TEXT NOT NULL,
  description   TEXT,
  department    TEXT NOT NULL CHECK (department IN ('SEO', 'Social Media')),
  assigned_date DATE NOT NULL,
  due_date      DATE NOT NULL,
  priority      TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High')),
  status        TEXT NOT NULL DEFAULT 'Not Started' CHECK (status IN ('Not Started', 'In Progress', 'Completed')),
  trainer_notes TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (due_date >= assigned_date)
);
CREATE INDEX tasks_intern_idx ON tasks (intern_id);
CREATE INDEX tasks_due_idx ON tasks (due_date) WHERE status <> 'Completed';

CREATE TABLE performance_reviews (
  id                BIGSERIAL PRIMARY KEY,
  intern_id         BIGINT NOT NULL REFERENCES interns (id) ON DELETE RESTRICT,
  review_date       DATE NOT NULL,
  work_quality      SMALLINT NOT NULL CHECK (work_quality BETWEEN 1 AND 5),
  learning_progress SMALLINT NOT NULL CHECK (learning_progress BETWEEN 1 AND 5),
  task_completion   SMALLINT NOT NULL CHECK (task_completion BETWEEN 1 AND 5),
  punctuality       SMALLINT NOT NULL CHECK (punctuality BETWEEN 1 AND 5),
  communication     SMALLINT NOT NULL CHECK (communication BETWEEN 1 AND 5),
  -- average of the five ratings, rounded to 1 decimal; computed by the app
  overall_rating    NUMERIC(2,1) NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  feedback          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reviews_intern_idx ON performance_reviews (intern_id, review_date DESC);

CREATE TABLE certificates (
  id                 BIGSERIAL PRIMARY KEY,
  intern_id          BIGINT NOT NULL UNIQUE REFERENCES interns (id) ON DELETE RESTRICT,
  eligibility        BOOLEAN NOT NULL DEFAULT false,
  status             TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Issued')),
  issue_date         DATE,
  certificate_number TEXT,
  certificate_url    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'Issued' OR (eligibility AND issue_date IS NOT NULL AND certificate_number IS NOT NULL))
);
CREATE UNIQUE INDEX certificates_number_key ON certificates (upper(certificate_number)) WHERE certificate_number IS NOT NULL;

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value) VALUES
  ('institute_name', 'HSIM'),
  ('attendance_threshold', '75'),
  ('ending_soon_days', '7');
