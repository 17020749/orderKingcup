// @ts-ignore Shared ESM helpers are executed directly by Node client tests.
import {
  chooseStickyTableCandidate,
  stickyScrollbarBounds,
} from '~/utils/stickyTableScrollbar.mjs'

type TableCandidate = {
  element: HTMLElement
  top: number
  bottom: number
  scrollWidth: number
  clientWidth: number
}

const STYLE_ID = 'sticky-table-scrollbar-style'
const PROXY_ID = 'sticky-table-scrollbar-proxy'

export default defineNuxtPlugin(nuxtApp => {
  let mainElement: HTMLElement | null = null
  let proxyElement: HTMLDivElement | null = null
  let spacerElement: HTMLDivElement | null = null
  let activeTable: HTMLElement | null = null
  let mutationObserver: MutationObserver | null = null
  let mainResizeObserver: ResizeObserver | null = null
  let tableResizeObserver: ResizeObserver | null = null
  let animationFrame = 0
  let syncingScroll = false
  let started = false

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      #${PROXY_ID} {
        position: fixed;
        bottom: 0;
        height: 19px;
        overflow-x: auto;
        overflow-y: hidden;
        overscroll-behavior-x: contain;
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid #dbe3ee;
        border-bottom: 0;
        border-radius: 10px 10px 0 0;
        box-shadow: 0 -4px 16px rgba(15, 23, 42, 0.12);
        z-index: 45;
        scrollbar-color: #94a3b8 #eef2f6;
      }
      #${PROXY_ID}[hidden] {
        display: none !important;
      }
      #${PROXY_ID}::-webkit-scrollbar {
        height: 14px;
      }
      #${PROXY_ID}::-webkit-scrollbar-track {
        background: #eef2f6;
        border-radius: 999px;
      }
      #${PROXY_ID}::-webkit-scrollbar-thumb {
        min-width: 44px;
        background: #94a3b8;
        border: 3px solid #eef2f6;
        border-radius: 999px;
      }
      #${PROXY_ID}::-webkit-scrollbar-thumb:hover {
        background: #64748b;
      }
      #${PROXY_ID} > div {
        height: 1px;
        min-width: 100%;
        pointer-events: none;
      }
      @media print {
        #${PROXY_ID} {
          display: none !important;
        }
      }
    `
    document.head.appendChild(style)
  }

  function ensureProxy() {
    const existing = document.getElementById(PROXY_ID)
    if (existing instanceof HTMLDivElement) {
      proxyElement = existing
      spacerElement = existing.firstElementChild instanceof HTMLDivElement
        ? existing.firstElementChild
        : null
    }

    if (!proxyElement) {
      proxyElement = document.createElement('div')
      proxyElement.id = PROXY_ID
      proxyElement.hidden = true
      proxyElement.tabIndex = 0
      proxyElement.setAttribute('role', 'scrollbar')
      proxyElement.setAttribute('aria-label', 'Cuộn ngang bảng dữ liệu')
      proxyElement.setAttribute('aria-orientation', 'horizontal')
      spacerElement = document.createElement('div')
      proxyElement.appendChild(spacerElement)
      document.body.appendChild(proxyElement)
    }

    proxyElement.removeEventListener('scroll', onProxyScroll)
    proxyElement.addEventListener('scroll', onProxyScroll, { passive: true })
  }

  function isRendered(element: HTMLElement) {
    const style = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && rect.width > 0
      && rect.height > 0
  }

  function observeMain(nextMain: HTMLElement | null) {
    if (mainElement === nextMain) return
    mutationObserver?.disconnect()
    mainResizeObserver?.disconnect()
    mainElement = nextMain

    if (!mainElement) return
    mutationObserver = new MutationObserver(scheduleRefresh)
    mutationObserver.observe(mainElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    })
    mainResizeObserver = new ResizeObserver(scheduleRefresh)
    mainResizeObserver.observe(mainElement)
  }

  function collectCandidates(): TableCandidate[] {
    observeMain(document.querySelector<HTMLElement>('.app-layout > .main'))
    if (!mainElement || document.querySelector('.modal-backdrop')) return []

    return Array.from(mainElement.querySelectorAll<HTMLElement>('.table-wrap'))
      .filter(element =>
        !element.closest('.modal-backdrop')
        && !element.hasAttribute('data-sticky-scroll-ignore')
        && isRendered(element),
      )
      .map(element => {
        const rect = element.getBoundingClientRect()
        return {
          element,
          top: rect.top,
          bottom: rect.bottom,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        }
      })
  }

  function onProxyScroll() {
    if (!proxyElement || !activeTable || syncingScroll) return
    syncingScroll = true
    activeTable.scrollLeft = proxyElement.scrollLeft
    proxyElement.setAttribute('aria-valuenow', String(Math.round(proxyElement.scrollLeft)))
    syncingScroll = false
  }

  function onTableScroll() {
    if (!proxyElement || !activeTable || syncingScroll) return
    syncingScroll = true
    proxyElement.scrollLeft = activeTable.scrollLeft
    proxyElement.setAttribute('aria-valuenow', String(Math.round(activeTable.scrollLeft)))
    syncingScroll = false
  }

  function setActiveTable(nextTable: HTMLElement | null) {
    if (activeTable === nextTable) return
    activeTable?.removeEventListener('scroll', onTableScroll)
    tableResizeObserver?.disconnect()
    activeTable = nextTable

    if (!activeTable) return
    activeTable.addEventListener('scroll', onTableScroll, { passive: true })
    tableResizeObserver = new ResizeObserver(scheduleRefresh)
    tableResizeObserver.observe(activeTable)
  }

  function hideProxy() {
    if (proxyElement) proxyElement.hidden = true
  }

  function refresh() {
    animationFrame = 0
    ensureStyle()
    ensureProxy()

    const candidate = chooseStickyTableCandidate(collectCandidates(), window.innerHeight) as TableCandidate | null
    if (!candidate || !mainElement || !proxyElement || !spacerElement) {
      setActiveTable(null)
      hideProxy()
      return
    }

    setActiveTable(candidate.element)
    const bounds = stickyScrollbarBounds(
      mainElement.getBoundingClientRect(),
      candidate.element.getBoundingClientRect(),
      window.innerWidth,
    )

    if (bounds.width < 80) {
      hideProxy()
      return
    }

    proxyElement.style.left = `${Math.round(bounds.left)}px`
    proxyElement.style.width = `${Math.round(bounds.width)}px`
    spacerElement.style.width = `${Math.max(candidate.element.scrollWidth, bounds.width)}px`
    proxyElement.setAttribute(
      'aria-valuemax',
      String(Math.max(0, Math.round(candidate.element.scrollWidth - candidate.element.clientWidth))),
    )
    proxyElement.setAttribute('aria-valuemin', '0')
    proxyElement.hidden = false

    if (Math.abs(proxyElement.scrollLeft - candidate.element.scrollLeft) > 1) {
      syncingScroll = true
      proxyElement.scrollLeft = candidate.element.scrollLeft
      proxyElement.setAttribute('aria-valuenow', String(Math.round(candidate.element.scrollLeft)))
      syncingScroll = false
    }
  }

  function scheduleRefresh() {
    if (animationFrame) return
    animationFrame = window.requestAnimationFrame(refresh)
  }

  function start() {
    if (started) return
    started = true
    ensureStyle()
    ensureProxy()
    observeMain(document.querySelector<HTMLElement>('.app-layout > .main'))

    window.addEventListener('resize', scheduleRefresh, { passive: true })
    window.addEventListener('scroll', scheduleRefresh, { passive: true, capture: true })
    document.addEventListener('visibilitychange', scheduleRefresh)
    scheduleRefresh()
  }

  function stop() {
    if (!started) return
    started = false
    if (animationFrame) window.cancelAnimationFrame(animationFrame)
    animationFrame = 0
    mutationObserver?.disconnect()
    mainResizeObserver?.disconnect()
    tableResizeObserver?.disconnect()
    activeTable?.removeEventListener('scroll', onTableScroll)
    proxyElement?.removeEventListener('scroll', onProxyScroll)
    window.removeEventListener('resize', scheduleRefresh)
    window.removeEventListener('scroll', scheduleRefresh, true)
    document.removeEventListener('visibilitychange', scheduleRefresh)
    proxyElement?.remove()
    document.getElementById(STYLE_ID)?.remove()
    mainElement = null
    proxyElement = null
    spacerElement = null
    activeTable = null
  }

  nuxtApp.hook('app:mounted', start)
  nuxtApp.hook('page:finish', scheduleRefresh)

  if (import.meta.hot) {
    import.meta.hot.dispose(stop)
  }
})
