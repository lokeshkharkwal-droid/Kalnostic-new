import {
  ImageFetcher,
  decodeHtmlAttr,
  guessImageMime,
  inlineRemoteImages,
  isRemoteUrl,
} from './pdf-image-inline.util';

/** A fetcher that returns fixed bytes for any URL and records what it was asked. */
function fakeFetcher(
  contentType = 'image/png',
  bytes = Buffer.from([1, 2, 3]),
): { fetcher: ImageFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: ImageFetcher = (url) => {
    calls.push(url);
    return Promise.resolve({ data: bytes, contentType });
  };
  return { fetcher, calls };
}

describe('pdf-image-inline util', () => {
  describe('decodeHtmlAttr', () => {
    it('decodes the entities escapeAttr introduces', () => {
      expect(decodeHtmlAttr('https://x/y?a=1&amp;b=2')).toBe(
        'https://x/y?a=1&b=2',
      );
      expect(decodeHtmlAttr('&lt;&gt;&quot;&amp;')).toBe('<>"&');
    });
  });

  describe('isRemoteUrl', () => {
    it('is true only for http(s) URLs', () => {
      expect(isRemoteUrl('https://cdn/logo.png')).toBe(true);
      expect(isRemoteUrl('http://cdn/logo.png')).toBe(true);
      expect(isRemoteUrl('data:image/png;base64,AAAA')).toBe(false);
      expect(isRemoteUrl('/uploads/logo.png')).toBe(false);
    });
  });

  describe('guessImageMime', () => {
    it('maps common extensions and ignores query strings', () => {
      expect(guessImageMime('https://x/logo.jpg?v=2')).toBe('image/jpeg');
      expect(guessImageMime('https://x/a.jpeg')).toBe('image/jpeg');
      expect(guessImageMime('https://x/a.svg')).toBe('image/svg+xml');
      expect(guessImageMime('https://x/a.unknown')).toBe('image/png');
    });
  });

  describe('inlineRemoteImages', () => {
    it('replaces a remote <img> src with a base64 data URI', async () => {
      const { fetcher } = fakeFetcher('image/png', Buffer.from([1, 2, 3]));
      const html = '<div><img src="https://cdn/logo.png" alt="logo" /></div>';
      const out = await inlineRemoteImages(html, fetcher);
      expect(out).toBe(
        `<div><img src="data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}" alt="logo" /></div>`,
      );
    });

    it('fetches the raw (entity-decoded) URL, not the escaped attribute', async () => {
      const { fetcher, calls } = fakeFetcher();
      await inlineRemoteImages(
        '<img src="https://cdn/logo.png?a=1&amp;b=2" />',
        fetcher,
      );
      expect(calls).toEqual(['https://cdn/logo.png?a=1&b=2']);
    });

    it('deduplicates repeated URLs into a single fetch', async () => {
      const { fetcher, calls } = fakeFetcher();
      const html =
        '<img src="https://cdn/logo.png" /><img src="https://cdn/logo.png" />';
      const out = await inlineRemoteImages(html, fetcher);
      expect(calls).toHaveLength(1);
      expect(out.match(/data:image\/png/g)).toHaveLength(2);
    });

    it('leaves data-URI and relative sources untouched (no fetch)', async () => {
      const { fetcher, calls } = fakeFetcher();
      const html =
        '<img src="data:image/png;base64,QQ==" /><img src="/uploads/x.png" />';
      const out = await inlineRemoteImages(html, fetcher);
      expect(out).toBe(html);
      expect(calls).toHaveLength(0);
    });

    it('keeps the original URL when the fetch fails', async () => {
      const failing: ImageFetcher = () => Promise.resolve(null);
      const html = '<img src="https://cdn/logo.png" alt="logo" />';
      expect(await inlineRemoteImages(html, failing)).toBe(html);
    });

    it('is a no-op for templates without an <img>', async () => {
      const { fetcher, calls } = fakeFetcher();
      const html = '<div class="pdf-footer">Page footer</div>';
      expect(await inlineRemoteImages(html, fetcher)).toBe(html);
      expect(calls).toHaveLength(0);
    });
  });
});
