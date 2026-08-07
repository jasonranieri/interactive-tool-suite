/* ==========================================================================
   Animated Slides v2 — Nav Bar
   The learner-facing navigation that lives INSIDE the exported bounding
   area — not authoring-tool chrome. This is the single implementation
   used by both the authoring preview and the export, so there's nothing
   that can drift out of sync the way v1's two separate copies did.

   Styling is project-wide (one navStyle object), not per-slide — the
   exact bug fixed in v1 was nav styling accidentally living on each slide
   individually and drifting apart. There's no settings UI for this yet
   (that's the separate canvas-settings panel, still to come); for now
   defaultNavStyle() is the single source of truth.

   OVERFLOW MODEL: buttons are grouped into PAGES that each fit entirely
   within the visible width, and exactly one page is shown at a time — a
   partial/cut-off button is never displayed. Left/right buttons move one
   page at a time and hide themselves at either end. There's no scrolling
   involved at all — pages are laid out once per resize, and moving
   between them animates the outgoing page's buttons out and the incoming
   page's buttons in with GSAP.
   ========================================================================== */

function defaultNavStyle() {
  return {
    navPosition: 'bottom',   // 'top' | 'bottom'
    navGap: 12,
    buttonColor: '#0C5E82', buttonTextColor: '#ffffff', buttonBottomColor: '#094A68',
    buttonInactiveColor: '#DCEBF2', buttonInactiveTextColor: '#073048', buttonInactiveBottomColor: '#B8D4DF',
    buttonFontSize: 14, buttonFontWeight: '700', buttonPaddingX: 20, buttonPaddingY: 8, buttonRadius: 8,
  };
}

function styleNavButton(btn, isActive, navStyle) {
  btn.style.fontFamily = 'inherit';
  btn.style.fontWeight = navStyle.buttonFontWeight || '700';
  btn.style.fontSize = navStyle.buttonFontSize + 'px';
  btn.style.padding = navStyle.buttonPaddingY + 'px ' + navStyle.buttonPaddingX + 'px';
  btn.style.borderRadius = navStyle.buttonRadius + 'px';
  btn.style.border = 'none';
  btn.style.borderBottom = '4px solid ' + (isActive ? navStyle.buttonBottomColor : navStyle.buttonInactiveBottomColor);
  btn.style.background = isActive ? navStyle.buttonColor : navStyle.buttonInactiveColor;
  btn.style.color = isActive ? navStyle.buttonTextColor : navStyle.buttonInactiveTextColor;
  btn.style.cursor = 'pointer';
  btn.style.whiteSpace = 'nowrap';
  btn.style.transition = 'filter 0.15s';
}

const SIDE_BUTTON_RESERVE = 72; // px reserved for both side buttons combined, even while hidden, so layout doesn't jump when they appear

/**
 * Sets up the nav bar inside `container`. Returns a
 * `refresh(slides, activeIndex)` to call whenever the slide list or the
 * active slide changes.
 */
function setupNavBar(container, navStyle, onNavigate) {
  container.innerHTML = '';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.gap = '6px';
  container.style.width = '100%';

  const measureRow = document.createElement('div');
  measureRow.style.position = 'absolute';
  measureRow.style.visibility = 'hidden';
  measureRow.style.pointerEvents = 'none';
  measureRow.style.display = 'flex';
  measureRow.style.gap = navStyle.navGap + 'px';
  measureRow.style.whiteSpace = 'nowrap';

  const leftBtn = document.createElement('button');
  const rightBtn = document.createElement('button');
  [leftBtn, rightBtn].forEach((b) => {
    b.style.border = 'none'; b.style.background = 'none'; b.style.cursor = 'pointer';
    b.style.display = 'none'; b.style.flexShrink = '0'; b.style.fontSize = '20px';
    b.style.color = navStyle.buttonColor; b.style.padding = '4px 8px'; b.style.lineHeight = '1';
  });
  leftBtn.textContent = '\u2039';
  rightBtn.textContent = '\u203A';
  leftBtn.setAttribute('aria-label', 'Previous slides');
  rightBtn.setAttribute('aria-label', 'Next slides');

  const pageRow = document.createElement('div');
  pageRow.style.display = 'flex';
  pageRow.style.gap = navStyle.navGap + 'px';
  pageRow.style.overflow = 'hidden'; // clips buttons mid-slide during the transition animation

  container.appendChild(measureRow);
  container.appendChild(leftBtn);
  container.appendChild(pageRow);
  container.appendChild(rightBtn);

  let slidesRef = [];
  let activeIndexRef = 0;
  let pages = [];          // array of arrays of slide indices
  let currentPageIndex = 0;

  function computePages() {
    measureRow.innerHTML = '';
    const widths = slidesRef.map((slide) => {
      const b = document.createElement('button');
      b.textContent = slide.name;
      styleNavButton(b, false, navStyle);
      measureRow.appendChild(b);
      return b.offsetWidth;
    });

    const available = (container.clientWidth || measureRow.offsetWidth) - SIDE_BUTTON_RESERVE;
    const gap = navStyle.navGap;
    const result = [];
    let page = [];
    let width = 0;
    widths.forEach((w, i) => {
      const added = page.length === 0 ? w : w + gap;
      if (width + added > available && page.length > 0) {
        result.push(page);
        page = [i];
        width = w;
      } else {
        page.push(i);
        width += added;
      }
    });
    if (page.length) result.push(page);
    pages = result.length ? result : [[]];
    if (currentPageIndex >= pages.length) currentPageIndex = pages.length - 1;
  }

  function makeButton(slideIndex) {
    const slide = slidesRef[slideIndex];
    const btn = document.createElement('button');
    btn.className = 'nav-pill' + (slideIndex === activeIndexRef ? ' active' : '');
    btn.textContent = slide.name;
    styleNavButton(btn, slideIndex === activeIndexRef, navStyle);
    btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(0.95)'; });
    btn.addEventListener('mouseleave', () => { btn.style.filter = ''; });
    btn.addEventListener('click', () => onNavigate(slideIndex));
    return btn;
  }

  /** Renders whichever page is at `index`. Pass a `dir` (1 or -1) to
   *  animate the swap (outgoing page slides/fades out that direction,
   *  incoming page slides/fades in from the opposite side); omit it for
   *  an instant render (initial load, resize, refresh). */
  function renderPage(index, dir) {
    const slideIndices = pages[index] || [];

    if (dir === undefined) {
      pageRow.innerHTML = '';
      slideIndices.forEach((i) => pageRow.appendChild(makeButton(i)));
      return;
    }

    const oldButtons = Array.from(pageRow.children);

    const showNewPage = () => {
      const newButtons = slideIndices.map(makeButton);
      newButtons.forEach((b) => pageRow.appendChild(b));
      gsap.fromTo(newButtons,
        { opacity: 0 },
        { opacity: 1, duration: 0.22, stagger: 0.03, ease: 'power2.out' }
      );
    };

    if (oldButtons.length) {
      gsap.to(oldButtons, {
        opacity: 0, duration: 0.16, ease: 'power1.in',
        onComplete: () => { oldButtons.forEach((b) => b.remove()); showNewPage(); },
      });
    } else {
      showNewPage();
    }
  }

  function updateSideButtons() {
    leftBtn.style.display = currentPageIndex > 0 ? '' : 'none';
    rightBtn.style.display = currentPageIndex < pages.length - 1 ? '' : 'none';
  }

  function goToPage(newIndex) {
    if (newIndex < 0 || newIndex >= pages.length || newIndex === currentPageIndex) return;
    const dir = newIndex > currentPageIndex ? 1 : -1;
    currentPageIndex = newIndex;
    renderPage(currentPageIndex, dir);
    updateSideButtons();
  }

  leftBtn.addEventListener('click', () => goToPage(currentPageIndex - 1));
  rightBtn.addEventListener('click', () => goToPage(currentPageIndex + 1));

  const ro = new ResizeObserver(() => {
    if (!slidesRef.length) return;
    computePages();
    renderPage(currentPageIndex);
    updateSideButtons();
  });
  ro.observe(container);

  function refresh(slides, activeIndex) {
    slidesRef = slides;
    activeIndexRef = activeIndex;
    // Re-applied every refresh, not just at setup — otherwise changing
    // the gap setting later has no visible effect, since these were only
    // ever set once at construction time.
    pageRow.style.gap = navStyle.navGap + 'px';
    measureRow.style.gap = navStyle.navGap + 'px';
    computePages();
    // Follow the active slide: whichever page contains it becomes the
    // shown page, so the bar stays in sync when navigation happens
    // elsewhere (editor tabs, keyboard, etc.). Instant, not animated —
    // this is a "jump to where we are," not a page-to-page move.
    const idx = pages.findIndex((p) => p.includes(activeIndex));
    if (idx !== -1) currentPageIndex = idx;
    renderPage(currentPageIndex);
    updateSideButtons();
  }

  return { refresh };
}

