-- Spec 030: the dashboard permission. Roles are stored in the roles table (spec 004), so the new name
-- is added to the four existing role rows. Nothing else changes; no table or trigger is touched.
UPDATE roles SET permissions_json = json_insert(permissions_json, '$[#]', 'dashboard.view')
  WHERE name IN ('owner', 'manager', 'staff', 'viewer') AND instr(permissions_json, '"dashboard.view"') = 0;
