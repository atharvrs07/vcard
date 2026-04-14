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

  function showOnlyPanel(panelId) {
    var overview = document.getElementById("panel-overview");
    var wl = document.getElementById("panel-whitelabel");
    if (!overview || !wl) return;
    overview.classList.toggle("d-none", panelId !== "panel-overview");
    wl.classList.toggle("d-none", panelId !== "panel-whitelabel");
    document.querySelectorAll("#dashboard-tabs .nav-link").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-target") === panelId);
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

  function setWlMessage(text, kind) {
    var ok = document.getElementById("wl-message");
    var err = document.getElementById("wl-error");
    if (!ok || !err) return;
    ok.classList.add("d-none");
    err.classList.add("d-none");
    if (!text) return;
    if (kind === "error") {
      err.textContent = text;
      err.classList.remove("d-none");
      return;
    }
    ok.textContent = text;
    ok.classList.remove("d-none");
  }

  function sanitizePathInput(v) {
    return String(v || "")
      .trim()
      .toLowerCase()
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
  }

  var currentCards = [];

  function fillCardSelect(cards) {
    var sel = document.getElementById("wl-card");
    if (!sel) return;
    currentCards = Array.isArray(cards) ? cards.slice() : [];
    sel.innerHTML = '<option value="">Choose a card...</option>';
    currentCards.forEach(function (card) {
      var slug = (card && card.slug) || "";
      if (!slug) return;
      var opt = document.createElement("option");
      opt.value = slug;
      opt.textContent = slug;
      sel.appendChild(opt);
    });
  }

  function updateCurrentMappingLine(state) {
    var line = document.getElementById("wl-current");
    if (!line) return;
    if (!state || !state.customDomain || !state.customPath || !state.slug) {
      line.textContent = "No mapping configured yet.";
      return;
    }
    var url = "https://" + state.customDomain + "/" + state.customPath;
    line.innerHTML =
      'Mapped card <b>' +
      String(state.slug).replace(/</g, "&lt;") +
      "</b> to <a href=\"" +
      url.replace(/"/g, "&quot;") +
      '" target="_blank" rel="noopener">' +
      url.replace(/</g, "&lt;") +
      "</a>";
  }

  function applyWlState(state) {
    var sel = document.getElementById("wl-card");
    var domain = document.getElementById("wl-domain");
    var path = document.getElementById("wl-path");
    if (!sel || !domain || !path) return;
    sel.value = (state && state.slug) || "";
    domain.value = (state && state.customDomain) || "";
    path.value = (state && state.customPath) || "";
    updateCurrentMappingLine(state);
  }

  function loadWhitelabelState() {
    return fetch("/whitelabel/state")
      .then(parseJson)
      .then(function (data) {
        fillCardSelect(data.cards || []);
        applyWlState(data.mapping || null);
      })
      .catch(function (e) {
        setWlMessage(e.message || "Could not load whitelabel state.", "error");
      });
  }

  function wireWhitelabelForm() {
    var form = document.getElementById("whitelabel-form");
    var clearBtn = document.getElementById("wl-clear-btn");
    var pathEl = document.getElementById("wl-path");
    if (!form || !clearBtn || !pathEl) return;

    pathEl.addEventListener("input", function () {
      pathEl.value = sanitizePathInput(pathEl.value).replace(/[^a-z0-9-]/g, "");
    });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      setWlMessage("", "");
      var slug = (document.getElementById("wl-card").value || "").trim().toLowerCase();
      var customDomain = (document.getElementById("wl-domain").value || "").trim().toLowerCase();
      var customPath = sanitizePathInput(document.getElementById("wl-path").value);
      fetch("/whitelabel/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug, customDomain: customDomain, customPath: customPath }),
      })
        .then(parseJson)
        .then(function (data) {
          applyWlState(data.mapping || null);
          setWlMessage("Whitelabel mapping saved.");
          return fetch("/my-cards").then(parseJson).then(function (cardsData) {
            renderCards(cardsData.cards || []);
          });
        })
        .catch(function (e) {
          setWlMessage(e.message || "Could not save mapping.", "error");
        });
    });

    clearBtn.addEventListener("click", function () {
      setWlMessage("", "");
      fetch("/whitelabel/clear", {
        method: "POST",
      })
        .then(parseJson)
        .then(function () {
          applyWlState(null);
          setWlMessage("Whitelabel mapping cleared.");
          return fetch("/my-cards").then(parseJson).then(function (cardsData) {
            renderCards(cardsData.cards || []);
          });
        })
        .catch(function (e) {
          setWlMessage(e.message || "Could not clear mapping.", "error");
        });
    });
  }

  document.querySelectorAll("#dashboard-tabs .nav-link").forEach(function (btn) {
    btn.addEventListener("click", function () {
      showOnlyPanel(btn.getAttribute("data-target"));
    });
  });

  showOnlyPanel("panel-overview");
  wireWhitelabelForm();

  fetch("/auth/me")
    .then(parseJson)
    .then(function (data) {
      var name = (data.account && (data.account.name || data.account.email)) || "there";
      var w = document.getElementById("welcome-line");
      if (w) w.textContent = "Welcome, " + name;
      return fetch("/my-cards").then(parseJson);
    })
    .then(function (data) {
      renderCards(data.cards || []);
      return loadWhitelabelState();
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
