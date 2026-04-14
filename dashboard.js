(function () {
  "use strict";

  var cardsCache = [];

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
    cardsCache = Array.isArray(cards) ? cards.slice() : [];
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
    populateCardSelect(cardsCache);
  }

  function populateCardSelect(cards) {
    var sel = document.getElementById("domain-card-slug");
    if (!sel) return;
    sel.innerHTML = "";
    if (!Array.isArray(cards) || cards.length === 0) {
      sel.innerHTML = '<option value="">No cards yet</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    cards.forEach(function (c) {
      var slug = (c && c.slug) || "";
      if (!slug) return;
      var opt = document.createElement("option");
      opt.value = slug;
      opt.textContent = slug;
      sel.appendChild(opt);
    });
  }

  function showDomainMsg(text, ok) {
    var box = document.getElementById("domain-msg");
    if (!box) return;
    box.style.display = "block";
    box.className = "alert " + (ok ? "alert-success" : "alert-danger");
    box.textContent = text;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderDomainMappings(mappings) {
    var wrap = document.getElementById("domain-mappings-wrap");
    if (!wrap) return;
    if (!Array.isArray(mappings) || mappings.length === 0) {
      wrap.className = "muted";
      wrap.textContent = "No domain mapping yet.";
      return;
    }
    wrap.className = "";
    wrap.innerHTML = mappings
      .map(function (m) {
        var statusBadge =
          m.status === "verified"
            ? '<span class="badge badge-success">Verified</span>'
            : '<span class="badge badge-warning">Pending verification</span>';
        var verifyBtn =
          m.status === "verified"
            ? ""
            : '<button class="btn btn-sm btn-outline-info mr-2 btn-domain-verify" data-id="' +
              escapeHtml(m.id) +
              '">Verify DNS</button>';
        return (
          '<div class="border rounded p-3 mb-2">' +
          '<div class="d-flex justify-content-between align-items-center mb-1">' +
          '<strong>' +
          escapeHtml(m.connect_url) +
          "</strong>" +
          statusBadge +
          "</div>" +
          '<div class="small mb-2">Card: <code>' +
          escapeHtml(m.card_slug) +
          "</code></div>" +
          '<div class="small mb-2">Add TXT record: <code>' +
          escapeHtml(m.verification_dns_name) +
          "</code> = <code>" +
          escapeHtml(m.verification_token) +
          "</code></div>" +
          '<div class="small mb-2">Point domain/CNAME target to: <code>' +
          escapeHtml(m.dns_target) +
          "</code></div>" +
          '<div>' +
          verifyBtn +
          '<button class="btn btn-sm btn-outline-danger btn-domain-disconnect" data-id="' +
          escapeHtml(m.id) +
          '">Disconnect</button>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    wrap.querySelectorAll(".btn-domain-verify").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        verifyDomainMapping(id);
      });
    });
    wrap.querySelectorAll(".btn-domain-disconnect").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        disconnectDomainMapping(id);
      });
    });
  }

  function loadDomainMappings() {
    return fetch("/domain/status")
      .then(parseJson)
      .then(function (data) {
        renderDomainMappings(data.mappings || []);
      });
  }

  function connectDomain() {
    var slugEl = document.getElementById("domain-card-slug");
    var domainEl = document.getElementById("domain-input");
    var pathEl = document.getElementById("domain-path-input");
    var payload = {
      card_slug: (slugEl && slugEl.value) || "",
      domain: (domainEl && domainEl.value) || "",
      path: (pathEl && pathEl.value) || "vcard",
    };
    fetch("/domain/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(parseJson)
      .then(function () {
        showDomainMsg("Domain mapping saved. Add DNS records, then click Verify DNS.", true);
        return loadDomainMappings();
      })
      .catch(function (e) {
        showDomainMsg(e.message || "Could not connect domain", false);
      });
  }

  function verifyDomainMapping(id) {
    fetch("/domain/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapping_id: id }),
    })
      .then(parseJson)
      .then(function () {
        showDomainMsg("Domain verified successfully.", true);
        return loadDomainMappings();
      })
      .catch(function (e) {
        showDomainMsg(e.message || "Verification failed", false);
      });
  }

  function disconnectDomainMapping(id) {
    fetch("/domain/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapping_id: id }),
    })
      .then(parseJson)
      .then(function () {
        showDomainMsg("Domain mapping removed.", true);
        return loadDomainMappings();
      })
      .catch(function (e) {
        showDomainMsg(e.message || "Could not disconnect domain", false);
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
      return loadDomainMappings();
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

  var connectBtn = document.getElementById("btn-domain-connect");
  if (connectBtn) connectBtn.addEventListener("click", connectDomain);
  var refreshBtn = document.getElementById("btn-domain-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      loadDomainMappings().catch(function (e) {
        showDomainMsg(e.message || "Could not refresh domain status", false);
      });
    });
  }
})();
