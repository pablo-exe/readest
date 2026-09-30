import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { listDirectory, type WebDAVConfig } from '@/services/sync/providers/webdav/client';

/**
 * Tests for the PROPFIND listing parser, focused on the metadata fields
 * that drive the browser's sort/search. `getcontentlength` /
 * `getlastmodified` were already parsed; `creationdate` was added so the
 * browser can offer "sort by date created". Servers that omit the
 * property must still produce a valid entry with `created === undefined`.
 */

const ORIGINAL_FETCH = globalThis.fetch;

const config: WebDAVConfig = {
  serverUrl: 'https://dav.example.com',
  username: 'alice',
  password: 'secret',
};

const multistatus = (inner: string): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/books/</D:href>
    <D:propstat>
      <D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  ${inner}
</D:multistatus>`;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('listDirectory metadata parsing', () => {
  test('decodes XML entities before URL escapes, without decoding a literal entity twice', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        multistatus(`
      <D:response><D:href>/books/Historia &amp; ciencia &#x26; arte.epub</D:href>
      <D:propstat><D:prop><D:resourcetype/><D:getetag>&quot;v1&quot;</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>
      <D:response><D:href>/books/Literal%20&amp;amp;.epub</D:href></D:response>
    `),
        { status: 207 },
      ),
    );
    const entries = await listDirectory(config, '/books');
    expect(entries[0]?.path).toBe('/books/Historia & ciencia & arte.epub');
    expect(entries[0]?.etag).toBe('"v1"');
    expect(entries[1]?.path).toBe('/books/Literal &amp;.epub');
  });

  test('following decoded entries preserves literal percent escapes and filename whitespace', async () => {
    fetchMock.mockResolvedValueOnce(new Response(multistatus(''), { status: 207 }));
    await listDirectory(config, '/books/100%20 real ', true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://dav.example.com/books/100%2520%20real%20');
  });
  test('rejects malformed or non-WebDAV responses instead of reporting an empty catalog', async () => {
    for (const xml of ['<html>Login</html>', '<D:multistatus xmlns:D="DAV:"><D:response>']) {
      fetchMock.mockResolvedValueOnce(new Response(xml, { status: 207 }));
      await expect(listDirectory(config, '/books')).rejects.toThrow('Invalid WebDAV');
    }
  });

  test('requests creationdate in the PROPFIND body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(multistatus(''), { status: 207 }));
    await listDirectory(config, '/books');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe('PROPFIND');
    expect(String(init?.body)).toContain('creationdate');
  });

  test('parses creationdate, getlastmodified and getcontentlength for a file', async () => {
    const fileResponse = `
      <D:response>
        <D:href>/books/novel.epub</D:href>
        <D:propstat>
          <D:prop>
            <D:resourcetype/>
            <D:getcontentlength>1234</D:getcontentlength>
            <D:getlastmodified>Mon, 15 Jan 2024 10:30:00 GMT</D:getlastmodified>
            <D:creationdate>2023-12-01T08:00:00Z</D:creationdate>
          </D:prop>
          <D:status>HTTP/1.1 200 OK</D:status>
        </D:propstat>
      </D:response>`;
    fetchMock.mockResolvedValueOnce(new Response(multistatus(fileResponse), { status: 207 }));

    const entries = await listDirectory(config, '/books');
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.name).toBe('novel.epub');
    expect(entry.isDirectory).toBe(false);
    expect(entry.size).toBe(1234);
    expect(entry.lastModified).toBe('Mon, 15 Jan 2024 10:30:00 GMT');
    expect(entry.created).toBe('2023-12-01T08:00:00Z');
  });

  test('leaves created undefined when the server omits creationdate', async () => {
    const dirResponse = `
      <D:response>
        <D:href>/books/sub/</D:href>
        <D:propstat>
          <D:prop>
            <D:resourcetype><D:collection/></D:resourcetype>
            <D:getlastmodified>Mon, 15 Jan 2024 10:30:00 GMT</D:getlastmodified>
          </D:prop>
          <D:status>HTTP/1.1 200 OK</D:status>
        </D:propstat>
      </D:response>`;
    fetchMock.mockResolvedValueOnce(new Response(multistatus(dirResponse), { status: 207 }));

    const entries = await listDirectory(config, '/books');
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.name).toBe('sub');
    expect(entry.isDirectory).toBe(true);
    expect(entry.created).toBeUndefined();
  });
});
