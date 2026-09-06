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

  it('never throws on malformed templates (returns something)', () => {
    expect(() =>
      renderLatte(`{foreach garbage}{/foreach}{$x->`, {}),
    ).not.toThrow();
  });
});
