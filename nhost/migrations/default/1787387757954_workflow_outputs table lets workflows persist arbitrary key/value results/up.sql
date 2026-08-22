CREATE TABLE workflow_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id),
  key text NOT NULL,
  value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
