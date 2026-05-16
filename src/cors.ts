const DEFAULT_CORS_ALLOW_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-API-Key',
  'Anthropic-Version',
  'Anthropic-Beta',
  'Anthropic-Dangerous-Direct-Browser-Access',
  'OpenAI-Beta',
  'OpenAI-Organization',
  'OpenAI-Project',
  'X-Request-ID',
].join(', ');

const CORS_BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function getAllowedRequestHeaders(request?: Request): string {
  return request?.headers.get('access-control-request-headers')?.trim() || DEFAULT_CORS_ALLOW_HEADERS;
}

export function applyCorsHeaders(headers: Headers, request?: Request): void {
  Object.entries(CORS_BASE_HEADERS).forEach(([key, value]) => headers.set(key, value));
  headers.set('Access-Control-Allow-Headers', getAllowedRequestHeaders(request));
}

export function withCorsHeaders(response: Response, request?: Request): Response {
  const headers = new Headers(response.headers);
  applyCorsHeaders(headers, request);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createCorsPreflightResponse(request?: Request): Response {
  const headers = new Headers();
  applyCorsHeaders(headers, request);
  return new Response(null, { status: 200, headers });
}
