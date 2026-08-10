-- Enums first, matching the spec's exact vocabulari
CREATE TYPE org_role AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE step_type AS ENUM ('llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate');
CREATE TYPE trigger_type AS ENUM ('manual', 'webhook', 'scheduled', 'event');
CREATE TYPE run_status AS ENUM ('pending', 'running', 'paused', 'completed', 'failed');
CREATE TYPE step_run_status AS ENUM ('pending', 'running', 'succeeded', 'failed', 'paused', 'skipped');

-- organizations: usage quota lives here per the brief
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  quota_limit int NOT NULL DEFAULT 1000,
  quota_used int NOT NULL DEFAULT 0,
  quota_period_start timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- org_members: the table every Layer 1 permission traces through
CREATE TABLE public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role org_role NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

-- workflows: belongs to an org
CREATE TABLE public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- workflow_steps: ordered, typed, JSONB config as the brief allows
CREATE TABLE public.workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  step_order int NOT NULL,
  type step_type NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, step_order)
);

-- workflow_triggers: trigger type tied to a workflow
CREATE TABLE public.workflow_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  type trigger_type NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- workflow_runs: one per execution, must support paused per brief
CREATE TABLE public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  status run_status NOT NULL DEFAULT 'pending',
  triggered_by uuid REFERENCES auth.users(id), -- nullable: webhook/scheduled/event runs have no human trigger
  trigger_type trigger_type NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- step_runs: one per step per run, with approval fields per spec
CREATE TABLE public.step_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  workflow_step_id uuid NOT NULL REFERENCES public.workflow_steps(id) ON DELETE CASCADE,
  status step_run_status NOT NULL DEFAULT 'pending',
  input jsonb,
  output jsonb,
  error text,
  attempt_count int NOT NULL DEFAULT 0,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for the query patterns the brief actually needs
CREATE INDEX idx_org_members_org ON public.org_members(org_id);
CREATE INDEX idx_org_members_user ON public.org_members(user_id);
CREATE INDEX idx_workflows_org ON public.workflows(org_id);
CREATE INDEX idx_workflow_steps_workflow ON public.workflow_steps(workflow_id, step_order);
CREATE INDEX idx_workflow_triggers_workflow ON public.workflow_triggers(workflow_id);
CREATE INDEX idx_workflow_runs_workflow ON public.workflow_runs(workflow_id);
CREATE INDEX idx_step_runs_run ON public.step_runs(workflow_run_id);
CREATE INDEX idx_step_runs_step ON public.step_runs(workflow_step_id);

-- Required aggregation: org-level usage view, per brief's explicit ask
CREATE VIEW public.org_usage_summary AS
SELECT
  o.id AS org_id,
  o.name AS org_name,
  o.quota_limit,
  o.quota_used,
  ROUND(o.quota_used::numeric / NULLIF(o.quota_limit, 0) * 100, 2) AS quota_used_pct,
  COUNT(DISTINCT wr.id) AS total_runs_this_period,
  AVG(EXTRACT(EPOCH FROM (wr.completed_at - wr.started_at)))
    FILTER (WHERE wr.completed_at IS NOT NULL) AS avg_run_duration_seconds
FROM public.organizations o
LEFT JOIN public.workflows w ON w.org_id = o.id
LEFT JOIN public.workflow_runs wr ON wr.workflow_id = w.id
  AND wr.created_at >= o.quota_period_start
GROUP BY o.id, o.name, o.quota_limit, o.quota_used;
