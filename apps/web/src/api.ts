let csrf = "";
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T>(
  url: string,
  method = "GET",
  body?: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api" + url, {
      method,
      credentials: "same-origin",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        ...(method === "GET" ? {} : { "X-CSRF-Token": csrf }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new ApiError("请求已取消", 0, "ABORTED");
    throw new ApiError("无法连接服务器", 0, "NETWORK");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      data.error?.message || "请求失败",
      response.status,
      data.error?.code || "HTTP_ERROR",
    );
  return data as T;
}
