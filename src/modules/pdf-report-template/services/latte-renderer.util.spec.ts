import { renderLatte } from './latte-renderer.util';

/**
 * Exercises the exact mechanics the "Lab All Reports" template depends on:
 * nested `{foreach}` over `report_tests->groups`/`->tests`, `{var}` counters
 * with `+` arithmetic, `'…' . $n` string concat, `{if …=="1"}` gating,
 * `{include}`/`{define}` blocks with params, `|noescape`, `{* comments *}`, and
 * the page-break-between-tests count logic (`{if $current < $final}`).
 */
describe('renderLatte', () => {
  it('substitutes variables and object paths, escaping by default', () => {
    const out = renderLatte(`Hi {$patient->full_name} <{$patient->email}>`, {
      patient: { full_name: 'A & B', email: 'a@b.co' },
    });
    expect(out).toBe('Hi A &amp; B <a@b.co>');
  });

  it('honours |noescape for pre-rendered HTML', () => {
    const out = renderLatte(`{$body|noescape}`, { body: '<div>x</div>' });
    expect(out).toBe('<div>x</div>');
  });

  it('applies |upper / |lower transform filters (still escaping output)', () => {
    expect(renderLatte(`{$name|upper}`, { name: 'john doe' })).toBe('JOHN DOE');
    expect(renderLatte(`{$name|lower}`, { name: 'JOHN' })).toBe('john');
    // Transform runs, then the result is HTML-escaped by default.
    expect(renderLatte(`{$v|upper}`, { v: 'a & b' })).toBe('A &amp; B');
    // Combined with |noescape → transformed but not escaped.
    expect(renderLatte(`{$v|upper|noescape}`, { v: 'a & b' })).toBe('A & B');
    // Unknown filters pass the value through unchanged.
    expect(renderLatte(`{$v|bogus}`, { v: 'x' })).toBe('x');
  });

  it('maps {PAGENO}/{nb} to Puppeteer page-number spans', () => {
    expect(renderLatte(`Page {PAGENO} of {nb}`, {})).toBe(
      'Page <span class="pageNumber"></span> of <span class="totalPages"></span>',
    );
  });

  it('supports + arithmetic and . concatenation in expressions', () => {
    expect(renderLatte(`{var $n = 2}{var $n = $n + 3}{$n}`, {})).toBe('5');
    expect(renderLatte(`{var $h = 'page_' . ($n + 1)}{$h}`, { n: 4 })).toBe(
      'page_5',
    );
  });

  it('strips {* comments *}', () => {
    expect(renderLatte(`a{* hidden *}b`, {})).toBe('ab');
  });

  it('renders {include} against a {define} block with bound params', () => {
    const tpl = `{include greet, $person, 'Hello'}{define greet, $who, $word}{$word}, {$who->name}!{/define}`;
    expect(renderLatte(tpl, { person: { name: 'Sam' } })).toBe('Hello, Sam!');
  });

  it('iterates every test across groups + non-grouped and paginates between them', () => {
    // 3 tests total (1 grouped + 2 non-grouped) → exactly 2 page breaks.
    const data = {
      header_fields: {
        external_order_id: 'ORD-123',
        patient: { full_name: 'John Doe' },
      },
      report_tests: {
        groups: [
          {
            group_name: 'Hematology',
            reports: [
              {
                body_html: '<div>CBC</div>',
                tests: [{ display_test_sample: '1' }],
              },
            ],
          },
        ],
        tests: [
          {
            body_html: '<div>Glucose</div>',
            tests: [{ display_test_sample: '1' }],
          },
          {
            body_html: '<div>Lipid</div>',
            tests: [{ display_test_sample: '1' }],
          },
        ],
      },
    };

    const tpl = `
{* pre-count every test that will be rendered *}
{var $current = 0}
{var $final = 0}
{foreach $report_tests->groups as $group}{foreach $group->reports as $report}{foreach $report->tests as $test}{if $test->display_test_sample == "1"}{var $final = $final + 1}{/if}{/foreach}{/foreach}{/foreach}
{foreach $report_tests->tests as $report}{var $final = $final + 1}{/foreach}
{* grouped *}
{foreach $report_tests->groups as $group}{foreach $group->reports as $report}{foreach $report->tests as $test}{if $test->display_test_sample == "1"}{var $current = $current + 1}{include page_header, $report, $header_fields, $group->group_name}<div class="b">{$report->body_html|noescape}</div>{if $current < $final}<div class="pb"></div>{/if}{/if}{/foreach}{/foreach}{/foreach}
{* non-grouped *}
{foreach $report_tests->tests as $report}{var $current = $current + 1}{include page_header, $report, $header_fields, ''}<div class="b">{$report->body_html|noescape}</div>{if $current < $final}<div class="pb"></div>{/if}{/foreach}
{define page_header, $report, $header_fields, $group_name}<div class="h">{$header_fields->external_order_id}|{$header_fields->patient.full_name}|{$group_name}</div>{/define}`;

    const out = renderLatte(tpl, data);

    // Every test's body rendered (HTML preserved via |noescape).
    expect(out).toContain('<div>CBC</div>');
    expect(out).toContain('<div>Glucose</div>');
    expect(out).toContain('<div>Lipid</div>');
    // Header block rendered once per test (3×), with header_fields resolved.
    expect((out.match(/class="h"/g) ?? []).length).toBe(3);
    expect((out.match(/ORD-123/g) ?? []).length).toBe(3);
    expect((out.match(/John Doe/g) ?? []).length).toBe(3);
    // Group name flows into the grouped header, empty for the non-grouped ones.
    expect(out).toContain('ORD-123|John Doe|Hematology');
    // Counting via `+` works → exactly (N-1) = 2 page breaks between 3 tests.
    expect((out.match(/class="pb"/g) ?? []).length).toBe(2);
    // Comments stripped.
    expect(out).not.toContain('pre-count');
  });

  it('supports {for} counted loops with $i++ and a condition', () => {
    expect(renderLatte(`{for $i = 1; $i <= 3; $i++}[{$i}]{/for}`, {})).toBe(
      '[1][2][3]',
    );
    // Decrement + explicit assignment increment forms.
    expect(renderLatte(`{for $i = 3; $i > 0; $i--}{$i}{/for}`, {})).toBe('321');
    expect(
      renderLatte(`{for $i = 0; $i < 6; $i = $i + 2}{$i},{/for}`, {}),
    ).toBe('0,2,4,');
  });

  it('supports {elseif} chains', () => {
    const tpl = `{if $n > 0}pos{elseif $n < 0}neg{else}zero{/if}`;
    expect(renderLatte(tpl, { n: 5 })).toBe('pos');
    expect(renderLatte(tpl, { n: -5 })).toBe('neg');
    expect(renderLatte(tpl, { n: 0 })).toBe('zero');
  });

  it('supports the ternary operator ? :', () => {
    expect(renderLatte(`{$n > 0 ? 'pos' : 'neg'}`, { n: 3 })).toBe('pos');
    expect(renderLatte(`{$n > 0 ? 'pos' : 'neg'}`, { n: -3 })).toBe('neg');
    // Nested in the else branch (right-associative).
    expect(renderLatte(`{$n > 0 ? 'p' : $n < 0 ? 'n' : 'z'}`, { n: 0 })).toBe(
      'z',
    );
  });

  it('supports the null-coalescing operator ??', () => {
    expect(renderLatte(`{$missing ?? 'fallback'}`, {})).toBe('fallback');
    expect(renderLatte(`{$name ?? 'fallback'}`, { name: 'Sam' })).toBe('Sam');
    // Chained: first non-null wins.
    expect(renderLatte(`{$a ?? $b ?? 'z'}`, { b: 'B' })).toBe('B');
  });

  it('supports * / % arithmetic with correct precedence', () => {
    expect(renderLatte(`{2 + 3 * 4}`, {})).toBe('14');
    expect(renderLatte(`{(2 + 3) * 4}`, {})).toBe('20');
    expect(renderLatte(`{10 / 4}`, {})).toBe('2.5');
    expect(renderLatte(`{10 % 3}`, {})).toBe('1');
    expect(renderLatte(`{5 / 0}`, {})).toBe('0'); // div-by-zero guarded → 0
  });

  it('supports whitelisted function calls', () => {
    expect(renderLatte(`{count($xs)}`, { xs: [1, 2, 3] })).toBe('3');
    expect(renderLatte(`{number_format($n, 2)}`, { n: 1234567.891 })).toBe(
      '1,234,567.89',
    );
    expect(renderLatte(`{round($n, 1)}`, { n: 3.14159 })).toBe('3.1');
    expect(renderLatte(`{max($a, $b, 10)}`, { a: 3, b: 7 })).toBe('10');
    expect(renderLatte(`{implode(', ', $xs)}`, { xs: ['a', 'b', 'c'] })).toBe(
      'a, b, c',
    );
    // upper() output is still HTML-escaped by default.
    expect(renderLatte(`{upper($s)}`, { s: 'a & b' })).toBe('A &amp; B');
    // Unknown functions render empty (allow-list — no arbitrary execution).
    expect(renderLatte(`{system('rm -rf /')}`, {})).toBe('');
  });

  it('supports array literals + index access, incl. in foreach/functions', () => {
    expect(renderLatte(`{$xs[1]}`, { xs: ['a', 'b', 'c'] })).toBe('b');
    expect(renderLatte(`{$m['k']}`, { m: { k: 'v' } })).toBe('v');
    expect(renderLatte(`{count([1, 2, 3, 4])}`, {})).toBe('4');
    expect(renderLatte(`{foreach [10, 20, 30] as $v}{$v};{/foreach}`, {})).toBe(
      '10;20;30;',
    );
    // Associative literal.
    expect(
      renderLatte(
        `{foreach ['a' => 1, 'b' => 2] as $k => $v}{$k}={$v} {/foreach}`,
        {},
      ),
    ).toBe('a=1 b=2 ');
  });

  it('caps runaway {for} loops instead of hanging', () => {
    // Condition never becomes false; the iteration guard must stop it.
    const out = renderLatte(`{for $i = 0; $i >= 0; $i++}x{/for}`, {});
    expect(out.length).toBe(100_000); // MAX_ITERATIONS guard
  });

  it('never throws on malformed templates (returns something)', () => {
    expect(() =>
      renderLatte(`{foreach garbage}{/foreach}{$x->`, {}),
    ).not.toThrow();
  });
});
