/**
 * Braze REST API helper for live round-trip integration tests.
 *
 * Wraps two endpoints:
 *   POST /users/export/ids  — query a user profile
 *   POST /users/delete      — clean up test users
 */

export interface BrazeUserExport {
  external_id?: string;
  email?: string;
  custom_attributes?: Record<string, unknown>;
  custom_events?: Array<{ name: string; count: number }>;
  purchases?: Array<{ name: string; count: number }>;
  [key: string]: unknown;
}

export interface BrazeAPI {
  exportUser(externalId: string): Promise<BrazeUserExport | null>;
  deleteUser(externalId: string): Promise<void>;
  waitForUser(
    externalId: string,
    predicate: (user: BrazeUserExport) => boolean,
    opts?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<BrazeUserExport>;
}

export function createBrazeAPI(restApiKey: string, restUrl: string): BrazeAPI {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${restApiKey}`,
  };

  async function exportUser(externalId: string): Promise<BrazeUserExport | null> {
    const res = await fetch(`${restUrl}/users/export/ids`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        external_ids: [externalId],
        fields_to_export: [
          'external_id',
          'email',
          'custom_attributes',
          'custom_events',
          'purchases',
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Braze export failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const users: BrazeUserExport[] = data.users ?? [];
    return users.length > 0 ? users[0] : null;
  }

  async function deleteUser(externalId: string): Promise<void> {
    const res = await fetch(`${restUrl}/users/delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ external_ids: [externalId] }),
    });

    if (!res.ok) {
      console.warn(`Braze delete failed: ${res.status} ${await res.text()}`);
    }
  }

  async function waitForUser(
    externalId: string,
    predicate: (user: BrazeUserExport) => boolean,
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<BrazeUserExport> {
    const interval = opts.intervalMs ?? 3000;
    const timeout = opts.timeoutMs ?? 30000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const user = await exportUser(externalId);
      if (user && predicate(user)) return user;
      await new Promise((r) => setTimeout(r, interval));
    }

    // One final attempt after the loop
    const user = await exportUser(externalId);
    if (user && predicate(user)) return user;

    throw new Error(
      `Timed out after ${timeout}ms waiting for user "${externalId}" to match predicate`,
    );
  }

  return { exportUser, deleteUser, waitForUser };
}
