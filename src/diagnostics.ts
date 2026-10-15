import { appendFileSync } from 'node:fs';
import type { BrowserContext, Request, Response, Page } from 'playwright';

export function safeRequestMetadata(request: Request) {
  const url = new URL(request.url());
  return {
    destination: /(^|\.)irctc\.co\.in$/i.test(url.hostname) ? 'irctc' : 'other',
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(request.method()) ? request.method() : 'other',
    resourceType: request.resourceType(),
  };
}

export function recordDiagnostics(context: BrowserContext, file: string) {
  const started = Date.now();
  let nextId = 0;
  const requests = new WeakMap<Request, { id: number; started: number }>();
  const write = (event: Record<string, unknown>) => appendFileSync(file, JSON.stringify({ elapsedMs: Date.now() - started, ...event }) + '\n', 'utf8');
  const onRequest = (request: Request) => {
    if (!['document', 'xhr', 'fetch'].includes(request.resourceType())) return;
    const entry = { id: ++nextId, started: Date.now() };
    requests.set(request, entry);
    write({ event: 'request', id: entry.id, ...safeRequestMetadata(request) });
  };
  const onResponse = (response: Response) => {
    const entry = requests.get(response.request());
    if (entry) write({ event: 'response', id: entry.id, status: response.status(), elapsedToHeadersMs: Date.now() - entry.started });
  };
  const onFinished = (request: Request) => {
    const entry = requests.get(request);
    if (entry) write({ event: 'finished', id: entry.id, durationMs: Date.now() - entry.started });
  };
  const onFailed = (request: Request) => {
    const entry = requests.get(request);
    if (entry) write({ event: 'failed', id: entry.id, durationMs: Date.now() - entry.started,
      code: request.failure()?.errorText.match(/\bnet::ERR_[A-Z_]+\b/)?.[0] || 'unclassified' });
  };
  const pages = new Map<Page, () => void>();
  const onPage = (page: Page) => {
    const onNavigation = () => {
      let route = 'other';
      try {
        const pathname = new URL(page.url()).pathname;
        if (/^\/nget\/error\/?$/i.test(pathname)) route = 'irctc-error';
        else if (/^\/nget\/train-search\/?$/i.test(pathname)) route = 'train-search';
      } catch { /* about:blank */ }
      write({ event: 'navigation', route });
    };
    pages.set(page, onNavigation);
    page.on('framenavigated', onNavigation);
  };
  context.on('request', onRequest);
  context.on('response', onResponse);
  context.on('requestfinished', onFinished);
  context.on('requestfailed', onFailed);
  context.on('page', onPage);
  for (const page of context.pages()) onPage(page);
  return {
    write,
    stop() {
      context.removeListener('request', onRequest);
      context.removeListener('response', onResponse);
      context.removeListener('requestfinished', onFinished);
      context.removeListener('requestfailed', onFailed);
      context.removeListener('page', onPage);
      for (const [page, listener] of pages) page.removeListener('framenavigated', listener);
      write({ event: 'recording-stopped' });
    },
  };
}
