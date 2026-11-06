(function () {
  'use strict';
  var d = document;
  d.documentElement.classList.add('js');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sticky header state
  var header = d.querySelector('.site-header');
  function onScroll() { if (header) header.classList.toggle('stuck', window.scrollY > 24); }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Mobile menu
  var btn = d.querySelector('.menu-btn'), nav = d.getElementById('nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open);
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    });
  }

  // Scroll reveal (also drives dosha bars and the steps line)
  var targets = d.querySelectorAll('.rv, .dc, .steps');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: .15, rootMargin: '0px 0px -6% 0px' });
    targets.forEach(function (t) { io.observe(t); });
  } else {
    targets.forEach(function (t) { t.classList.add('in'); });
  }

  // Count-up numbers
  var counters = d.querySelectorAll('[data-count]');
  function run(b) {
    var to = +b.dataset.count, pre = b.dataset.prefix || '', t0 = null;
    if (reduce) { b.textContent = pre + to; return; }
    function step(t) {
      if (!t0) t0 = t;
      var p = Math.min((t - t0) / 1600, 1), e = 1 - Math.pow(1 - p, 3);
      b.textContent = pre + Math.round(to * e).toLocaleString('en-IN');
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (counters.length) {
    if ('IntersectionObserver' in window) {
      var co = new IntersectionObserver(function (en) {
        en.forEach(function (e) { if (e.isIntersecting) { run(e.target); co.unobserve(e.target); } });
      }, { threshold: .6 });
      counters.forEach(function (c) { co.observe(c); });
    } else { counters.forEach(run); }
  }

  // Dosha cards: tap to toggle on touch devices
  d.querySelectorAll('.dc').forEach(function (c) {
    c.addEventListener('click', function () {
      d.querySelectorAll('.dc.open').forEach(function (o) { if (o !== c) o.classList.remove('open'); });
      c.classList.toggle('open');
    });
  });

  // Appointment form -> WhatsApp message (same behaviour as the original site)
  var f = d.getElementById('book-form');
  if (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var x = new FormData(f);
      var msg = 'Hello, I would like to book an appointment at Jeevan Jyoti Ayurveda, Karnal.%0A'
        + 'Name: ' + encodeURIComponent(x.get('name')) + '%0A'
        + 'Phone: ' + encodeURIComponent(x.get('phone')) + '%0A'
        + 'Visit type: ' + encodeURIComponent(x.get('mode')) + '%0A'
        + 'Concern: ' + encodeURIComponent(x.get('concern')) + '%0A'
        + 'Preferred time: ' + encodeURIComponent(x.get('time')) + '%0A'
        + 'Details: ' + encodeURIComponent(x.get('notes') || '-');
      window.open('https://wa.me/' + (f.getAttribute('data-wa') || '919215613888') + '?text=' + msg, '_blank', 'noopener');
    });
  }
})();
