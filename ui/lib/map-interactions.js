export function initMapInteractions({
  svg,
  mapContainer,
  tooltip,
  findCommuneFromTarget,
  resolveCommuneFromEvent,
  showContextMenuForCommune,
  hideContextMenu,
  handleCommuneClick,
}) {
  const bbox = svg.getBBox();
  const initialViewBox = svg.getAttribute("viewBox");
  let viewBox;

  if (initialViewBox) {
    const parts = initialViewBox.split(/\s+|,/).map(Number);
    viewBox = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  } else {
    viewBox = { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height };
    svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
  }

  const panZoom = {
    viewBox,
    initialViewBox: { ...viewBox },
    minScale: 0.6,
    maxScale: 8,
    isDragging: false,
    moved: false,
    startPoint: null,
    startViewBox: null,
    resetView: null,
  };

  function applyViewBox() {
    svg.setAttribute(
      "viewBox",
      `${panZoom.viewBox.x} ${panZoom.viewBox.y} ${panZoom.viewBox.w} ${panZoom.viewBox.h}`
    );
  }

  panZoom.resetView = () => {
    panZoom.viewBox = { ...panZoom.initialViewBox };
    applyViewBox();
  };

  function clampScale(newW) {
    const scale = viewBox.w / newW;
    if (scale < panZoom.minScale) return viewBox.w / panZoom.minScale;
    if (scale > panZoom.maxScale) return viewBox.w / panZoom.maxScale;
    return newW;
  }

  function zoomAt(clientX, clientY, deltaScale) {
    const rect = svg.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;

    let newW = panZoom.viewBox.w * deltaScale;
    newW = clampScale(newW);
    const newH = (newW * panZoom.viewBox.h) / panZoom.viewBox.w;

    const dx = (panZoom.viewBox.w - newW) * px;
    const dy = (panZoom.viewBox.h - newH) * py;

    panZoom.viewBox = {
      x: panZoom.viewBox.x + dx,
      y: panZoom.viewBox.y + dy,
      w: newW,
      h: newH,
    };
    applyViewBox();
  }

  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const delta = Math.sign(event.deltaY);
      const zoomFactor = delta > 0 ? 1.12 : 0.9;
      zoomAt(event.clientX, event.clientY, zoomFactor);
    },
    { passive: false }
  );

  svg.addEventListener("pointerdown", (event) => {
    const communeEl = findCommuneFromTarget(event.target);
    if (event.button === 0 && event.shiftKey && communeEl) {
      event.preventDefault();
      showContextMenuForCommune(communeEl, event.clientX, event.clientY);
      return;
    }
    if (event.button !== 0) return;
    panZoom.isDragging = true;
    panZoom.moved = false;
    panZoom.startPoint = { x: event.clientX, y: event.clientY };
    panZoom.startViewBox = { ...panZoom.viewBox };
  });

  svg.addEventListener("pointermove", (event) => {
    if (!panZoom.isDragging) return;
    const rect = svg.getBoundingClientRect();
    const rawDx = event.clientX - panZoom.startPoint.x;
    const rawDy = event.clientY - panZoom.startPoint.y;
    if (!panZoom.moved && Math.hypot(rawDx, rawDy) > 3) {
      panZoom.moved = true;
      svg.classList.add("dragging");
      svg.setPointerCapture(event.pointerId);
    }
    if (!panZoom.moved) return;
    const dx = ((event.clientX - panZoom.startPoint.x) / rect.width) * panZoom.startViewBox.w;
    const dy = ((event.clientY - panZoom.startPoint.y) / rect.height) * panZoom.startViewBox.h;

    panZoom.viewBox = {
      x: panZoom.startViewBox.x - dx,
      y: panZoom.startViewBox.y - dy,
      w: panZoom.startViewBox.w,
      h: panZoom.startViewBox.h,
    };
    applyViewBox();
  });

  function endDrag(event) {
    if (!panZoom.isDragging) return;
    panZoom.isDragging = false;
    panZoom.moved = false;
    svg.classList.remove("dragging");
    try {
      svg.releasePointerCapture(event.pointerId);
    } catch (err) {
      // ignore if pointer capture not available
    }
  }

  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointerleave", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  svg.addEventListener("click", (event) => {
    hideContextMenu();
    const communeEl = findCommuneFromTarget(event.target);
    if (!communeEl) return;
    if (event.shiftKey) {
      showContextMenuForCommune(communeEl, event.clientX, event.clientY);
      return;
    }
    handleCommuneClick(communeEl);
  });

  svg.addEventListener("contextmenu", (event) => {
    const communeEl = resolveCommuneFromEvent(event);
    if (!communeEl) return;
    event.preventDefault();
    showContextMenuForCommune(communeEl, event.clientX, event.clientY);
  });

  mapContainer.addEventListener("contextmenu", (event) => {
    const communeEl = resolveCommuneFromEvent(event);
    if (!communeEl) {
      hideContextMenu();
      return;
    }
    event.preventDefault();
    showContextMenuForCommune(communeEl, event.clientX, event.clientY);
  });

  // Chrome fallback: some SVG/pan interactions can swallow native contextmenu.
  mapContainer.addEventListener("mousedown", (event) => {
    if (event.button !== 2) return;
    const communeEl = resolveCommuneFromEvent(event);
    if (!communeEl) {
      hideContextMenu();
      return;
    }
    event.preventDefault();
    showContextMenuForCommune(communeEl, event.clientX, event.clientY);
  });

  svg.addEventListener("mousemove", (event) => {
    if (!tooltip) return;
    const communeEl = findCommuneFromTarget(event.target);
    if (!communeEl) {
      tooltip.classList.add("hidden");
      return;
    }
    tooltip.textContent = communeEl.getAttribute("data-tooltip") || "";
    tooltip.classList.remove("hidden");
    const containerRect = mapContainer.getBoundingClientRect();
    tooltip.style.left = `${event.clientX - containerRect.left}px`;
    tooltip.style.top = `${event.clientY - containerRect.top}px`;
  });

  svg.addEventListener("mouseleave", () => {
    if (tooltip) tooltip.classList.add("hidden");
  });

  return panZoom;
}
