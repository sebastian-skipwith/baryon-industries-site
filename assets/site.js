// Shared behaviour for every public Baryon page: glass header once scrolled,
// phone nav toggle, and reveal-on-scroll. No dependencies.
(() => {
  const header = document.querySelector(".site-header");
  if (header && !header.classList.contains("is-solid")) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".site-nav");
  if (toggle && nav) {
    if (!nav.id) nav.id = "site-nav";
    toggle.setAttribute("aria-controls", nav.id);
    const isOpen = () => nav.classList.contains("is-open");
    const close = (refocus) => {
      if (!isOpen()) return;
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      if (refocus) toggle.focus();
    };
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) close(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) close(true);
    });
    document.addEventListener("pointerdown", (e) => {
      if (isOpen() && !nav.contains(e.target) && !toggle.contains(e.target)) close(false);
    });
    // The phone menu is hidden by CSS above 720px; reset it so it is not open on the way back down.
    const wide = matchMedia("(min-width: 721px)");
    const onWide = () => { if (wide.matches) close(false); };
    if (wide.addEventListener) wide.addEventListener("change", onWide);
    else if (wide.addListener) wide.addListener(onWide);
  }

  const items = document.querySelectorAll(".reveal");
  if (!items.length) return;
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    items.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("is-visible");
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.12 });
  items.forEach((el) => io.observe(el));
})();
