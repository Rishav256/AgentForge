-- Adds created_by to organizations, required by trg_add_creator_as_owner trigger
ALTER TABLE public.organizations
ADD COLUMN created_by uuid REFERENCES auth.users(id);
