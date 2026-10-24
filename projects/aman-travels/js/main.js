(function () {
  var WA_NUMBER = "919253030998";

  var toggle = document.querySelector(".menu-toggle");
  var nav = document.querySelector(".nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open);
    });
  }

  document.querySelectorAll("form[data-enquiry]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var lines = ["Hello Aman Travels, I would like to enquire:"];
      new FormData(form).forEach(function (value, key) {
        if (String(value).trim()) {
          var label = form.querySelector('[name="' + key + '"]').getAttribute("data-label") || key;
          lines.push(label + ": " + value);
        }
      });
      window.open("https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(lines.join("\n")), "_blank", "noopener");
    });
  });

  var preset = new URLSearchParams(location.search).get("service");
  var select = document.querySelector('select[name="service"]');
  if (preset && select) select.value = preset;

  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
