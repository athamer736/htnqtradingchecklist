import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseInline, parseRichText, stripFormatting } from '../src/shared/richText'

describe('parseInline', () => {
  it('handles bold, italic and plain text', () => {
    assert.deepEqual(parseInline('a **b** c *d*'), [
      { t: 'text', v: 'a ' },
      { t: 'b', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' c ' },
      { t: 'i', c: [{ t: 'text', v: 'd' }] }
    ])
  })

  it('nests italic inside bold', () => {
    assert.deepEqual(parseInline('**a *b* c**'), [
      { t: 'b', c: [{ t: 'text', v: 'a ' }, { t: 'i', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' c' }] }
    ])
  })

  it('leaves stray or spaced asterisks alone', () => {
    for (const s of ['2 * 3 * 4', 'a * b', '**', '*', 'x ** y', 'snake_case_name']) {
      assert.deepEqual(parseInline(s), [{ t: 'text', v: s }])
    }
  })

  it('never produces markup from html-looking text', () => {
    assert.deepEqual(parseInline('<img src=x onerror=alert(1)> [a](http://x)'), [
      { t: 'text', v: '<img src=x onerror=alert(1)> [a](http://x)' }
    ])
  })
})

describe('parseRichText', () => {
  it('splits paragraphs on blank lines and keeps single line breaks', () => {
    const b = parseRichText('one\ntwo\n\nthree')
    assert.equal(b.length, 2)
    assert.equal(b[0].t === 'p' && b[0].lines.length, 2)
    assert.equal(b[1].t === 'p' && b[1].lines.length, 1)
  })

  it('reads headings, bullets and numbered lists', () => {
    const b = parseRichText('# Big\n## Small\n- a\n* b\n• c\n1. x\n2) y\ntext')
    assert.deepEqual(
      b.map((x) => x.t),
      ['h', 'h', 'ul', 'ol', 'p']
    )
    assert.equal(b[0].t === 'h' && b[0].level, 1)
    assert.equal(b[1].t === 'h' && b[1].level, 2)
    assert.equal(b[2].t === 'ul' && b[2].items.length, 3)
    assert.equal(b[3].t === 'ol' && b[3].items.length, 2)
  })

  it('treats "*italic*" at the start of a line as text, not a bullet', () => {
    const b = parseRichText('*italic* line')
    assert.equal(b[0].t, 'p')
  })

  it('handles CRLF and empty input', () => {
    assert.equal(parseRichText('a\r\nb').length, 1)
    assert.deepEqual(parseRichText(''), [])
  })
})

describe('stripFormatting', () => {
  it('flattens a description to one plain line', () => {
    assert.equal(stripFormatting('# Plan\n- **one**\n- *two*\n\nend'), 'Plan one two end')
  })
})
