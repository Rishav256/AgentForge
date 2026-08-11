CREATE OR REPLACE FUNCTION public.add_creator_as_owner()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_add_creator_as_owner
AFTER INSERT ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_as_owner();
