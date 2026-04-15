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
    var embed = document.getElementById("panel-website-embed");
    if (!overview || !embed) return;
    overview.classList.toggle("d-none", panelId !== "panel-overview");
    embed.classList.toggle("d-none", panelId !== "panel-website-embed");
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

  function normalizeCardUrl(raw, slug) {
    // Always prefer the selected card slug on this app domain.
    // This avoids showing stale external URLs previously saved in profile_link.
    var cleanSlug = String(slug || "").trim().toLowerCase();
    if (cleanSlug) return window.location.origin + "/" + cleanSlug;
    var s = String(raw || "").trim();
    if (s && /^https?:\/\//i.test(s)) return s;
    if (s.startsWith("/")) return window.location.origin + s;
    if (s) return window.location.origin + "/" + s.replace(/^\/+/, "");
    return "";
  }

  var cardsBySlug = {};

  function fillWebsiteCardSelect(cards) {
    var sel = document.getElementById("website-card-slug");
    if (!sel) return;
    cardsBySlug = {};
    sel.innerHTML = '<option value="">Choose a card...</option>';
    (Array.isArray(cards) ? cards : []).forEach(function (card) {
      var slug = (card && card.slug) || "";
      if (!slug) return;
      cardsBySlug[slug] = card;
      var opt = document.createElement("option");
      opt.value = slug;
      opt.textContent = slug;
      sel.appendChild(opt);
    });
  }

  function setEmbedStatus(text) {
    var status = document.getElementById("website-embed-status");
    if (status) status.textContent = text || "";
  }

  function updateEmbedSelectionState() {
    var select = document.getElementById("website-card-slug");
    var linkEl = document.getElementById("website-card-link");
    var previewBtn = document.getElementById("website-preview-link");
    if (!select || !linkEl || !previewBtn) return;
    var slug = String(select.value || "").trim();
    var card = cardsBySlug[slug];
    var cardUrl = normalizeCardUrl(card && card.profile_link, slug);

    if (!slug || !cardUrl) {
      linkEl.textContent = "Select a card to view link";
      linkEl.href = "#";
      previewBtn.classList.add("d-none");
      previewBtn.href = "#";
      setEmbedStatus("Select a card to generate your downloadable file.");
      return;
    }

    linkEl.textContent = cardUrl;
    linkEl.href = cardUrl;
    previewBtn.classList.remove("d-none");
    previewBtn.href = cardUrl;
    setEmbedStatus("Ready. Download and upload as index.html on your own website.");
  }

  function wireWebsiteEmbedForm() {
    var form = document.getElementById("website-embed-form");
    var select = document.getElementById("website-card-slug");
    var copyBtn = document.getElementById("website-copy-url-btn");
    if (!form || !select || !copyBtn) return;

    select.addEventListener("change", updateEmbedSelectionState);

    copyBtn.addEventListener("click", function () {
      var slug = String(select.value || "").trim();
      var card = cardsBySlug[slug];
      var cardUrl = normalizeCardUrl(card && card.profile_link, slug);
      if (!cardUrl) {
        setEmbedStatus("Select a card first.");
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cardUrl)
          .then(function () {
            setEmbedStatus("Direct card URL copied.");
          })
          .catch(function () {
            setEmbedStatus("Could not copy automatically. Copy from the link above.");
          });
      } else {
        setEmbedStatus("Clipboard API not available. Copy from the link above.");
      }
    });

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var slug = String(select.value || "").trim().toLowerCase();
      if (!slug) {
        setEmbedStatus("Please select a card first.");
        return;
      }
      setEmbedStatus("Downloading index.html...");
      window.location.href = "/website-embed/" + encodeURIComponent(slug);
    });
  }

  document.querySelectorAll("#dashboard-tabs .nav-link").forEach(function (btn) {
    btn.addEventListener("click", function () {
      showOnlyPanel(btn.getAttribute("data-target"));
    });
  });

  showOnlyPanel("panel-overview");
  wireWebsiteEmbedForm();

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
      fillWebsiteCardSelect(data.cards || []);
      updateEmbedSelectionState();
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
