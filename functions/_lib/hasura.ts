const HASURA_URL = process.env.NHOST_GRAPHQL_URL as string;
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET as string;

export async function adminGraphQL<T = any>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    console.error('Hasura GraphQL error:', JSON.stringify(json.errors));
    throw new Error(json.errors[0]?.message ?? 'Unknown Hasura error');
  }
  return json.data as T;
}
