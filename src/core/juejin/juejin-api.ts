import type { Page } from 'playwright';

export async function callJuejinApi<T>(
  page: Page,
  path: string,
  payload: Record<string, unknown>,
  method: 'POST' | 'GET' = 'POST'
): Promise<T> {
  return page.evaluate(
    async ({ apiPath, body, httpMethod }) => {
      const response = await fetch(apiPath, {
        method: httpMethod,
        credentials: 'include',
        headers: {
          'content-type': 'application/json'
        },
        body: httpMethod === 'POST' ? JSON.stringify(body) : undefined
      });

      if (!response.ok) {
        throw new Error(`Juejin API failed with ${response.status}`);
      }

      const data = (await response.json()) as { err_no?: number; err_msg?: string; data?: unknown };

      if (data.err_no && data.err_no !== 0) {
        throw new Error(data.err_msg ?? `Juejin API error: ${data.err_no}`);
      }

      return data.data as T;
    },
    {
      apiPath: path,
      body: payload,
      httpMethod: method
    }
  );
}
