export function isHorizontallyOverflowing(scrollWidth, clientWidth, tolerance = 2) {
  const content = Number(scrollWidth) || 0
  const viewport = Number(clientWidth) || 0
  return content - viewport > Math.max(0, Number(tolerance) || 0)
}

export function visibleVerticalPixels(rect, viewportHeight) {
  const height = Math.max(0, Number(viewportHeight) || 0)
  const top = Math.max(0, Number(rect?.top) || 0)
  const bottom = Math.min(height, Number(rect?.bottom) || 0)
  return Math.max(0, bottom - top)
}

export function chooseStickyTableCandidate(candidates, viewportHeight) {
  const height = Math.max(0, Number(viewportHeight) || 0)
  return (Array.isArray(candidates) ? candidates : [])
    .filter(candidate =>
      candidate
      && isHorizontallyOverflowing(candidate.scrollWidth, candidate.clientWidth)
      && visibleVerticalPixels(candidate, height) > 0,
    )
    .sort((left, right) => {
      const leftTouchesBottom = Number(left.top) < height && Number(left.bottom) >= height - 1 ? 1 : 0
      const rightTouchesBottom = Number(right.top) < height && Number(right.bottom) >= height - 1 ? 1 : 0
      if (leftTouchesBottom !== rightTouchesBottom) return rightTouchesBottom - leftTouchesBottom

      const visibleDifference = visibleVerticalPixels(right, height) - visibleVerticalPixels(left, height)
      if (visibleDifference) return visibleDifference

      return Math.abs(Number(left.top) || 0) - Math.abs(Number(right.top) || 0)
    })[0] || null
}

export function stickyScrollbarBounds(mainRect, tableRect, viewportWidth) {
  const viewport = Math.max(0, Number(viewportWidth) || 0)
  const left = Math.max(
    0,
    Number(mainRect?.left) || 0,
    Number(tableRect?.left) || 0,
  )
  const right = Math.min(
    viewport,
    Number(mainRect?.right) || viewport,
    Number(tableRect?.right) || viewport,
  )
  return {
    left,
    width: Math.max(0, right - left),
  }
}
