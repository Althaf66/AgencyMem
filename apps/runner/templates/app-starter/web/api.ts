// The one fetch helper: JSON in and out; an API error becomes an ApiError with the API's code,
// message and field (sample-app.md section 7).
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; field?: string };
  } | null;
  if (!res.ok) {
    const error = body?.error;
    throw new ApiError(
      error?.code ?? "HTTP_ERROR",
      error?.message ?? `The server answered ${res.status}.`,
      error?.field,
    );
  }
  return body as T;
}
