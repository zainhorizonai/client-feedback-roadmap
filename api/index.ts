import { app } from '../server/app.js'

// Vercel entry point. vercel.json rewrites every /api/* request to this one function and passes the
// original path along as ?__path=..., so routing does not depend on how the platform reports the URL.
export function restoreUrl(request: Request): Request {
  const url = new URL(request.url)
  const original = url.searchParams.get('__path')
  if (original === null) return request
  url.searchParams.delete('__path')
  url.pathname = `/api/${original}`
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? request.body : undefined,
    // Required by the fetch spec when a request body is a stream.
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit)
}

const handler = (request: Request) => app.fetch(restoreUrl(request))

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const HEAD = handler
export const OPTIONS = handler
