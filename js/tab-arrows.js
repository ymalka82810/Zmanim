/* חצים בצדי שורת לשוניות שגוללים אותה לצדדים: החץ מופיע רק כשיש עוד לאן לגלול בכיוון שלו */
(function () {
  function attach(el) {
    if (!el || el.dataset.tabArrows) return;
    el.dataset.tabArrows = "1";
    var wrap = document.createElement("div");
    wrap.className = "tab-arrows-wrap";
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    var btns = {};
    [["left", "‹", -1], ["right", "›", 1]].forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tab-arrow tab-arrow-" + d[0];
      b.textContent = d[1];
      b.hidden = true;
      b.tabIndex = -1;
      b.setAttribute("aria-hidden", "true");
      b.addEventListener("click", function () {
        el.scrollBy({ left: d[2] * Math.max(120, el.clientWidth * 0.6), behavior: "smooth" });
      });
      wrap.appendChild(b);
      btns[d[0]] = b;
    });
    function update() {
      var max = el.scrollWidth - el.clientWidth;
      var pos = Math.abs(el.scrollLeft);
      var rtl = getComputedStyle(el).direction === "rtl";
      var left = rtl ? max - pos : pos;
      var right = rtl ? pos : max - pos;
      var h = el.offsetHeight + "px";
      btns.left.style.height = btns.right.style.height = h;
      btns.left.hidden = !(max > 1 && left > 1);
      btns.right.hidden = !(max > 1 && right > 1);
    }
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    if (window.ResizeObserver) new ResizeObserver(update).observe(el);
    new MutationObserver(update).observe(el, { childList: true, subtree: true, characterData: true });
    update();
  }
  window.attachTabArrows = attach;
  function init() {
    document.querySelectorAll("[data-tab-arrows-auto]").forEach(attach);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
