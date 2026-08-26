export const LOAD_PRINCIPAL_SQL = `SELECT p.id AS id, p.subject AS subject, p.kind AS kind,
            COALESCE((
              SELECT json_group_array(role) FROM roles WHERE principal_id = p.id
            ), '[]') AS roles,
            COALESCE((
              SELECT json_group_array(department) FROM departments WHERE principal_id = p.id
            ), '[]') AS departments
     FROM principals p
     WHERE p.subject = ? AND p.kind = ?`;

export type PrincipalDirectoryRow = {
  id: string;
  subject: string;
  kind: "user" | "service_token";
  roles: string | string[];
  departments: string | string[];
};
