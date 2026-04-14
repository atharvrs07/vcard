(function () {
  "use strict";

  function parseJson(r) {
    return r.text().then(function (t) {
      var data = {};
      try {
        data = t ? JSON.parse(t) : {};
      } catch (e) {}
      if (!r.ok) throw new Error(data.error || "Request failed");
      return data;
    });
  }

  function renderCards(cards) {
    var list = document.getElementById("cards-list");
    if (!list) return;
    list.innerHTML = "";
    if (!Array.isArray(cards) || cards.length === 0) {
      list.innerHTML = '<li class="muted">No cards published yet.</li>';
      return;
    }
    cards.forEach(function (c) {
      var li = document.createElement("li");
      var slug = (c && c.slug) || "";
      var href = (c && c.profile_link) || (slug ? (window.location.origin + "/" + slug) : "#");
      var views = Number(c && c.view_count) || 0;
      li.innerHTML =
        '<a href="' + href.replace(/"/g, "&quot;") + '" target="_blank" rel="noopener">' +
        (slug || href).replace(/</g, "&lt;") +
        "</a> · " + views + " views";
      list.appendChild(li);
    });
  }

  fetch("/auth/me")
    .then(parseJson)
    .then(function (data) {
      var name = (data.account && (data.account.name || data.account.email)) || "there";
      var w = document.getElementById("welcome-line");
      if (w) w.textContent = "Welcome, " + name;
      return fetch("/my-cards");
    })
    .then(parseJson)
    .then(function (data) {
      renderCards(data.cards || []);
    })
    .catch(function () {
      window.location.href = "/login";
    });

  var logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      fetch("/auth/logout", { method: "POST" })
        .catch(function () {})
        .finally(function () {
          window.location.href = "/login";
        });
    });
  }
})();
