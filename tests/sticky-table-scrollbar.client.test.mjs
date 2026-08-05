import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  chooseStickyTableCandidate,
  isHorizontallyOverflowing,
  stickyScrollbarBounds,
  visibleVerticalPixels,
} from '../utils/stickyTableScrollbar.mjs'

test('chỉ hiện thanh cuộn khi bảng thật sự tràn ngang', () => {
  assert.equal(isHorizontallyOverflowing(1200, 900), true)
  assert.equal(isHorizontallyOverflowing(901, 900), false)
  assert.equal(isHorizontallyOverflowing(900, 900), false)
})

test('chọn bảng rộng đang hiện trong màn hình và ưu tiên bảng kéo dài tới đáy', () => {
  const viewportHeight = 800
  const selected = chooseStickyTableCandidate([
    { id: 'hidden-above', top: -500, bottom: -20, scrollWidth: 1300, clientWidth: 800 },
    { id: 'fits', top: 100, bottom: 300, scrollWidth: 800, clientWidth: 800 },
    { id: 'visible-short', top: 80, bottom: 420, scrollWidth: 1300, clientWidth: 800 },
    { id: 'visible-at-bottom', top: 350, bottom: 1200, scrollWidth: 1500, clientWidth: 800 },
  ], viewportHeight)

  assert.equal(selected?.id, 'visible-at-bottom')
  assert.equal(visibleVerticalPixels({ top: 350, bottom: 1200 }, viewportHeight), 450)
})

test('giới hạn thanh cuộn trong vùng bảng và không lấn sang sidebar', () => {
  assert.deepEqual(
    stickyScrollbarBounds(
      { left: 280, right: 1600 },
      { left: 24, right: 1500 },
      1600,
    ),
    { left: 280, width: 1220 },
  )

  assert.deepEqual(
    stickyScrollbarBounds(
      { left: 280, right: 1600 },
      { left: 330, right: 1480 },
      1600,
    ),
    { left: 330, width: 1150 },
  )
})

test('plugin áp dụng toàn cục cho table-wrap và bỏ qua modal/sidebar', async () => {
  const source = await readFile(new URL('../plugins/sticky-table-scrollbar.client.ts', import.meta.url), 'utf8')

  assert.match(source, /\.app-layout > \.main/)
  assert.match(source, /querySelectorAll<HTMLElement>\('\.table-wrap'\)/)
  assert.match(source, /document\.querySelector\('\.modal-backdrop'\)/)
  assert.match(source, /stickyScrollbarBounds/)
  assert.match(source, /position: fixed/)
  assert.match(source, /bottom: 0/)
  assert.match(source, /page:finish/)
})
