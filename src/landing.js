const landing = document.querySelector("[data-landing]");
const enterLink = document.querySelector("[data-enter-simulation]");
const parallaxLayers = [...document.querySelectorAll("[data-parallax-x][data-parallax-y]")]
  .map((element) => ({
    element,
    depthX: Number(element.dataset.parallaxX),
    depthY: Number(element.dataset.parallaxY),
  }));

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let targetX = 0;
let targetY = 0;
let currentX = 0;
let currentY = 0;
let animationFrame = 0;
let listening = false;

function applyDepth(x, y) {
  for (const { element, depthX, depthY } of parallaxLayers) {
    element.style.setProperty("--layer-x", `${(x * depthX).toFixed(2)}px`);
    element.style.setProperty("--layer-y", `${(y * depthY).toFixed(2)}px`);
  }
}

function animateParallax() {
  currentX += (targetX - currentX) * 0.085;
  currentY += (targetY - currentY) * 0.085;
  applyDepth(currentX, currentY);

  if (Math.abs(targetX - currentX) > 0.001 || Math.abs(targetY - currentY) > 0.001) {
    animationFrame = requestAnimationFrame(animateParallax);
    return;
  }

  currentX = targetX;
  currentY = targetY;
  applyDepth(currentX, currentY);
  animationFrame = 0;
}

function requestParallaxFrame() {
  if (!animationFrame) animationFrame = requestAnimationFrame(animateParallax);
}

function onPointerMove(event) {
  if (event.pointerType === "touch") return;
  targetX = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth - 0.5) * 2));
  targetY = Math.max(-1, Math.min(1, (event.clientY / window.innerHeight - 0.5) * 2));
  if (reducedMotion.matches) {
    currentX = targetX;
    currentY = targetY;
    applyDepth(currentX, currentY);
    return;
  }
  requestParallaxFrame();
}

function onPointerOut(event) {
  // A browser can dispatch the final pointerout at the viewport boundary
  // before the pointer enters browser chrome. Keep that edge coordinate so
  // the composition does not snap back while the cursor is still there.
  if (!event.relatedTarget) {
    const screenWidth = Math.max(1, screen.availWidth || window.innerWidth);
    const screenHeight = Math.max(1, screen.availHeight || window.innerHeight);
    targetX = Math.max(-1, Math.min(1, ((event.screenX / screenWidth) - 0.5) * 2));
    targetY = Math.max(-1, Math.min(1, ((event.screenY / screenHeight) - 0.5) * 2));
    if (reducedMotion.matches) {
      currentX = targetX;
      currentY = targetY;
      applyDepth(currentX, currentY);
      return;
    }
    requestParallaxFrame();
  }
}

function resetParallax() {
  targetX = 0;
  targetY = 0;
  if (reducedMotion.matches) {
    currentX = 0;
    currentY = 0;
    applyDepth(0, 0);
    return;
  }
  requestParallaxFrame();
}

function startParallax() {
  if (listening || !landing) return;
  // Listen at document scope so the last valid screen position is retained
  // when the pointer crosses the viewport edge into browser chrome.
  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerout", onPointerOut, { passive: true });
  listening = true;
}

function syncParallaxMode() {
  startParallax();
  resetParallax();
}

function onEnter(event) {
  if (
    event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
    || reducedMotion.matches
  ) {
    return;
  }

  event.preventDefault();
  landing?.classList.add("is-leaving");
  window.setTimeout(() => window.location.assign(enterLink.href), 220);
}

reducedMotion.addEventListener("change", syncParallaxMode);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) resetParallax();
});
window.addEventListener("pageshow", () => landing?.classList.remove("is-leaving"));
enterLink?.addEventListener("click", onEnter);

syncParallaxMode();
