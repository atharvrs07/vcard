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

  function renderRows(cards) {
    var body = document.getElementById("analytics-rows");
    if (!body) return;
    body.innerHTML = "";
    if (!Array.isArray(cards) || cards.length === 0) {
      body.innerHTML = '<tr><td colspan="3" class="muted">No published cards yet.</td></tr>';
      return;
    }
    cards.forEach(function (card) {
      var slug = (card && card.slug) || "";
      var href = (card && card.profile_link) || (slug ? (window.location.origin + "/" + slug) : "#");
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + (slug || "-").replace(/</g, "&lt;") + "</td>" +
        "<td>" + (Number(card && card.view_count) || 0) + "</td>" +
        '<td><a href="' + href.replace(/"/g, "&quot;") + '" target="_blank" rel="noopener">Open</a></td>';
      body.appendChild(tr);
    });
  }

  fetch("/analytics-data")
    .then(parseJson)
    .then(function (data) {
      document.getElementById("total-cards").textContent = String(Number(data.totalCards) || 0);
      document.getElementById("total-views").textContent = String(Number(data.totalViews) || 0);
      renderRows(data.cards || []);
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
